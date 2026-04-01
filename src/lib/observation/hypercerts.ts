/**
 * HypercertStore — Plan-level impact certificates with crypto marketplace.
 *
 * Issues hypercerts that snapshot a federation plan as a cohesive whole.
 * Buyers purchase fractional ownership with ETH via MetaMask — funds
 * are sent to a treasury address that finances the social plan.
 *
 * Wallet integration:
 *   - connectWallet() → MetaMask popup → stores connected address
 *   - buyFraction() → sends ETH tx → records fraction with wallet + txHash
 *   - mintOnChain() → mints the cert itself on-chain via hypercerts SDK
 */

import { nanoid } from 'nanoid';
import type { FederationPlanResult } from '$lib/planning/plan-federation';
import { PLAN_TAGS, deficitShortfall } from '$lib/planning/planning';

// =============================================================================
// TYPES
// =============================================================================

export interface PlanHypercertMetadata {
    name: string;
    description: string;
    scopesPlanned: string[];
    totalDeficits: number;
    resolvedDeficits: number;
    coherence: number;              // 0–1
    lateralMatches: number;
    conservationSignals: number;
    contributors: string[];
    workTimeframe: { start: string; end: string };
}

export interface HypercertFraction {
    id: string;
    hypercertId: string;
    ownerId: string;                // wallet address (0x...)
    units: number;
    ethPaid: number;                // ETH amount paid
    txHash: string;                 // on-chain transaction hash
    claimedAt: string;
}

export interface PlanHypercert {
    id: string;
    metadata: PlanHypercertMetadata;
    totalUnits: number;
    availableUnits: number;
    pricePerUnit: number;           // ETH per fraction unit
    fundsRaised: number;            // total ETH collected
    fractions: HypercertFraction[];
    issuedAt: string;
    planSnapshotId: string;
    mintedOnChain: boolean;
    txHash?: string;
}

export type HypercertStoreEvent =
    | { type: 'issued'; cert: PlanHypercert }
    | { type: 'bought'; fraction: HypercertFraction; cert: PlanHypercert }
    | { type: 'wallet_connected'; address: string }
    | { type: 'wallet_disconnected' };

type HypercertListener = (event: HypercertStoreEvent) => void;

export type BuyResult =
    | { ok: true; fraction: HypercertFraction }
    | { ok: false; reason: string };

// =============================================================================
// STORE
// =============================================================================

export class HypercertStore {
    private certs = new Map<string, PlanHypercert>();
    private listeners: HypercertListener[] = [];

    /** Connected wallet address. */
    walletAddress: string | null = null;
    walletConnected = false;

    /** Total ETH raised across all certs. */
    totalFundsRaised = 0;

    /** Treasury address — ETH from purchases goes here to fund the social plan. */
    treasuryAddress = '0xA2AA608a5663DA75538C835e75e9D5a0d31f6BcA';

    /** Target chain for buy transactions. Sepolia testnet by default (free ETH from faucets). */
    readonly chainId = 11155111;        // Sepolia
    readonly chainName = 'Sepolia';
    readonly chainHex = '0xaa36a7';     // hex of 11155111

    constructor(private generateId: () => string = () => nanoid()) {}

    // =========================================================================
    // WALLET — MetaMask connection via window.ethereum
    // =========================================================================

    async connectWallet(): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
        try {
            if (typeof window === 'undefined' || !(window as any).ethereum) {
                return { ok: false, reason: 'No wallet detected — install MetaMask' };
            }

            const eth = (window as any).ethereum;

            // Request account access
            const accounts: string[] = await eth.request({
                method: 'eth_requestAccounts',
            });

            if (!accounts?.length) {
                return { ok: false, reason: 'No account selected' };
            }

            // Switch to Sepolia testnet if not already on it
            try {
                await eth.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: this.chainHex }],
                });
            } catch (switchErr: any) {
                // Chain not added — add Sepolia
                if (switchErr.code === 4902) {
                    await eth.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: this.chainHex,
                            chainName: 'Sepolia Testnet',
                            nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
                            rpcUrls: ['https://rpc.sepolia.org'],
                            blockExplorerUrls: ['https://sepolia.etherscan.io'],
                        }],
                    });
                }
            }

            this.walletAddress = accounts[0];
            this.walletConnected = true;
            this.emit({ type: 'wallet_connected', address: accounts[0] });
            return { ok: true, address: accounts[0] };
        } catch (e: any) {
            return { ok: false, reason: e.message ?? 'Wallet connection failed' };
        }
    }

    disconnectWallet(): void {
        this.walletAddress = null;
        this.walletConnected = false;
        this.emit({ type: 'wallet_disconnected' });
    }

    // =========================================================================
    // ISSUE
    // =========================================================================

    issuePlanCert(
        result: FederationPlanResult,
        _parentOf: Map<string, string>,
        label?: string,
    ): PlanHypercert {
        const snapshotId = `snap-${this.generateId()}`;

        let totalDeficits = 0;
        let resolvedDeficits = 0;
        for (const [, scopeResult] of result.byScope) {
            const defs = scopeResult.planStore.intentsForTag(PLAN_TAGS.DEFICIT);
            totalDeficits += defs.length;
            resolvedDeficits += defs.filter(d => deficitShortfall(d) === 0).length;
        }

        const coherence = totalDeficits > 0 ? resolvedDeficits / totalDeficits : 1;
        const now = new Date().toISOString();
        const scopeCount = result.planOrder.length;

        // Price per unit in ETH — scales with plan complexity
        const basePrice = 0.0001 * Math.max(coherence, 0.1) * (1 + result.lateralAgreements.length / Math.max(scopeCount, 1));
        const pricePerUnit = Math.round(basePrice * 1_000_000) / 1_000_000;

        const cert: PlanHypercert = {
            id: this.generateId(),
            metadata: {
                name: label ?? `Federation Plan ${new Date().toLocaleDateString()}`,
                description: `${scopeCount} scopes planned, ${resolvedDeficits}/${totalDeficits} deficits resolved, ${result.lateralAgreements.length} lateral matches`,
                scopesPlanned: [...result.planOrder],
                totalDeficits,
                resolvedDeficits,
                coherence,
                lateralMatches: result.lateralAgreements.length,
                conservationSignals: result.allConservationSignals.length,
                contributors: [...result.planOrder],
                workTimeframe: { start: now, end: now },
            },
            totalUnits: scopeCount * 1000,
            availableUnits: scopeCount * 1000,
            pricePerUnit,
            fundsRaised: 0,
            fractions: [],
            issuedAt: now,
            planSnapshotId: snapshotId,
            mintedOnChain: false,
        };

        this.certs.set(cert.id, cert);
        this.emit({ type: 'issued', cert });
        return cert;
    }

    // =========================================================================
    // BUY — purchase fractions with ETH via MetaMask
    // =========================================================================

    /**
     * Buy fractional ownership of a hypercert by sending ETH.
     *
     * The connected wallet sends ETH to the treasury address.
     * On confirmation, the fraction is recorded with the wallet address
     * and transaction hash.
     */
    async buyFraction(hypercertId: string, units: number): Promise<BuyResult> {
        const cert = this.certs.get(hypercertId);
        if (!cert) return { ok: false, reason: 'Cert not found' };
        if (!this.walletConnected || !this.walletAddress) {
            return { ok: false, reason: 'Connect your wallet first' };
        }
        if (units <= 0) return { ok: false, reason: 'Units must be > 0' };
        if (units > cert.availableUnits) {
            return { ok: false, reason: `Only ${cert.availableUnits} units available` };
        }

        const totalCostEth = units * cert.pricePerUnit;

        try {
            if (typeof window === 'undefined' || !(window as any).ethereum) {
                return { ok: false, reason: 'No wallet detected' };
            }

            // Convert ETH to wei (hex string)
            const weiValue = BigInt(Math.floor(totalCostEth * 1e18));
            const hexValue = '0x' + weiValue.toString(16);

            // Send ETH transaction to treasury
            const txHash: string = await (window as any).ethereum.request({
                method: 'eth_sendTransaction',
                params: [{
                    from: this.walletAddress,
                    to: this.treasuryAddress,
                    value: hexValue,
                }],
            });

            const fraction: HypercertFraction = {
                id: this.generateId(),
                hypercertId,
                ownerId: this.walletAddress,
                units,
                ethPaid: totalCostEth,
                txHash,
                claimedAt: new Date().toISOString(),
            };

            cert.availableUnits -= units;
            cert.fundsRaised += totalCostEth;
            cert.fractions.push(fraction);
            this.totalFundsRaised += totalCostEth;

            this.emit({ type: 'bought', fraction, cert });
            return { ok: true, fraction };
        } catch (e: any) {
            if (e.code === 4001) return { ok: false, reason: 'Transaction rejected' };
            return { ok: false, reason: e.message ?? 'Transaction failed' };
        }
    }

    // =========================================================================
    // BLOCKCHAIN — on-chain minting via @hypercerts-org/hypercerts-sdk
    // =========================================================================

    async mintOnChain(hypercertId: string): Promise<{ ok: true; txHash: string } | { ok: false; reason: string }> {
        const cert = this.certs.get(hypercertId);
        if (!cert) return { ok: false, reason: 'Cert not found' };
        if (cert.mintedOnChain) return { ok: false, reason: 'Already minted' };

        try {
            if (typeof window === 'undefined' || !(window as any).ethereum) {
                return { ok: false, reason: 'No wallet detected — install MetaMask' };
            }

            // The SDK v0.0.32 references process.env internally — polyfill for browser
            if (typeof globalThis.process === 'undefined') {
                (globalThis as any).process = { env: {} };
            }

            const sdk: any = await import('@hypercerts-org/hypercerts-sdk');

            const metaResult = sdk.formatHypercertData({
                name: cert.metadata.name,
                description: cert.metadata.description,
                image: '',
                version: '1.0',
                properties: [
                    { trait_type: 'coherence', value: String(cert.metadata.coherence) },
                    { trait_type: 'lateralMatches', value: String(cert.metadata.lateralMatches) },
                    { trait_type: 'fundsRaised', value: String(cert.fundsRaised) },
                ],
                impactScope: cert.metadata.scopesPlanned,
                excludedImpactScope: [],
                workScope: ['federation-planning'],
                excludedWorkScope: [],
                workTimeframeStart: Math.floor(new Date(cert.metadata.workTimeframe.start).getTime() / 1000),
                workTimeframeEnd: Math.floor(new Date(cert.metadata.workTimeframe.end).getTime() / 1000),
                impactTimeframeStart: Math.floor(new Date(cert.metadata.workTimeframe.start).getTime() / 1000),
                impactTimeframeEnd: Math.floor(new Date(cert.metadata.workTimeframe.end).getTime() / 1000),
                contributors: cert.metadata.contributors,
                rights: ['Public Display'],
                excludedRights: [],
            });

            if (!metaResult.valid) {
                return { ok: false, reason: `Metadata invalid: ${metaResult.errors?.join(', ')}` };
            }

            const accounts: string[] = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
            if (!accounts?.length) return { ok: false, reason: 'No account connected' };

            // Switch to Optimism (chainId 10) — the only mainnet the SDK v0.0.32 supports
            try {
                await (window as any).ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0xa' }], // 10 = Optimism
                });
            } catch (switchErr: any) {
                if (switchErr.code === 4902) {
                    await (window as any).ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0xa',
                            chainName: 'OP Mainnet',
                            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                            rpcUrls: ['https://mainnet.optimism.io'],
                            blockExplorerUrls: ['https://optimistic.etherscan.io'],
                        }],
                    });
                } else {
                    return { ok: false, reason: 'Must switch to Optimism to mint' };
                }
            }

            const { ethers } = await import('ethers') as any;
            const provider = new ethers.providers.Web3Provider((window as any).ethereum);
            const signer = provider.getSigner();

            // Full chainConfig to avoid process.env lookups inside SDK
            const minter = sdk.HypercertMinting({
                provider: signer,
                chainConfig: {
                    chainId: 10,
                    chainName: 'optimism-mainnet',
                    contractAddress: '0x822F17A9A5EeCFd66dBAFf7946a8071C265D1d07',
                    graphName: 'hypercerts-optimism-mainnet',
                },
            });

            const tx = await minter.mintHypercert(
                accounts[0],
                metaResult.data,
                cert.totalUnits,
                minter.transferRestrictions.FromCreatorOnly,
            );

            const txHash = tx?.hash ?? 'pending';
            cert.mintedOnChain = true;
            cert.txHash = txHash;
            return { ok: true, txHash };
        } catch (e: any) {
            return { ok: false, reason: e.message ?? 'Minting failed' };
        }
    }

    // =========================================================================
    // QUERIES
    // =========================================================================

    allCerts(): PlanHypercert[] {
        return [...this.certs.values()];
    }

    getCert(id: string): PlanHypercert | undefined {
        return this.certs.get(id);
    }

    latestCert(): PlanHypercert | undefined {
        const all = this.allCerts();
        return all.length > 0 ? all[all.length - 1] : undefined;
    }

    fractionsFor(ownerId: string): HypercertFraction[] {
        const result: HypercertFraction[] = [];
        for (const cert of this.certs.values()) {
            for (const f of cert.fractions) {
                if (f.ownerId === ownerId) result.push(f);
            }
        }
        return result;
    }

    totalAvailable(): number {
        let total = 0;
        for (const cert of this.certs.values()) total += cert.availableUnits;
        return total;
    }

    // =========================================================================
    // SUBSCRIBE
    // =========================================================================

    subscribe(listener: HypercertListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private emit(event: HypercertStoreEvent): void {
        for (const l of this.listeners) l(event);
    }
}
