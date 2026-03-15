/**
 * Membership Index — CIT and MEM from spec §§94–127.
 *
 * CIT: set of all persons in free association (flat citizen registry).
 * MEM: CIT → S — each citizen's primary scope membership.
 * MEM: S → S  — scope-to-parent hierarchy (scope → federation → UC).
 *
 * citizenShare(k) = |{c ∈ CIT : k is ancestor-or-self of MEM(c)}| / |CIT|
 * communeShare(F, k) = citizenShare(k) restricted to the sub-population
 *   whose MEM(c) is a descendant-or-self of F.
 */

import { z } from 'zod';
import type { Agent, AgentRelationship } from '../schemas';

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

export const MembershipIndexSchema = z.object({
    /** All citizens (Person agents). */
    citizens: z.set(z.string()),

    /** Person → primary scope (direct membership). */
    personToScope: z.map(z.string(), z.string()),

    /** Scope → parent scope (hierarchy). */
    scopeParent: z.map(z.string(), z.string()),

    /**
     * Scope → set of all citizens whose ancestor chain includes that scope.
     * Pre-computed for O(1) citizenShare queries.
     */
    scopeToDescendantCitizens: z.map(z.string(), z.set(z.string())),
});
export type MembershipIndex = z.infer<typeof MembershipIndexSchema>;

// =============================================================================
// BUILD
// =============================================================================

/**
 * Build a MembershipIndex from Agent and AgentRelationship records.
 *
 * Membership conventions (two relationship classes):
 *   - Person ↔ Scope: subject=personId, object=scopeId, relationship contains 'member'
 *   - Scope ↔ Parent: subject=scopeId, object=parentScopeId, relationship contains 'member'
 *     (this captures scope-to-federation and federation-to-UC hierarchies)
 *
 * When a person appears in multiple membership relationships the FIRST one
 * (in array order) is used as their primary scope. Callers should ensure the
 * input is ordered with primary memberships first.
 */
export function buildMembershipIndex(
    agents: Agent[],
    relationships: AgentRelationship[],
): MembershipIndex {
    const agentById = new Map<string, Agent>(agents.map(a => [a.id, a]));

    const citizens = new Set<string>();
    for (const a of agents) {
        if (a.type === 'Person') citizens.add(a.id);
    }

    // personToScope: first membership relationship where subject is a Person
    const personToScope = new Map<string, string>();
    // scopeParent: membership relationship where subject is an Organization
    const scopeParent = new Map<string, string>();

    for (const rel of relationships) {
        if (!rel.relationship.toLowerCase().includes('member')) continue;

        const subjectAgent = agentById.get(rel.subject);
        if (subjectAgent?.type === 'Person') {
            // Person → Scope: only record primary (first) membership
            if (!personToScope.has(rel.subject)) {
                personToScope.set(rel.subject, rel.object);
            }
        } else if (subjectAgent?.type === 'Organization') {
            // Scope → parent (first relationship wins)
            if (!scopeParent.has(rel.subject)) {
                scopeParent.set(rel.subject, rel.object);
            }
        }
    }

    // Pre-compute scopeToDescendantCitizens
    // For each citizen, walk the ancestor chain and add citizen to every ancestor scope.
    const scopeToDescendantCitizens = new Map<string, Set<string>>();

    function ensureSet(scopeId: string): Set<string> {
        if (!scopeToDescendantCitizens.has(scopeId)) {
            scopeToDescendantCitizens.set(scopeId, new Set());
        }
        return scopeToDescendantCitizens.get(scopeId)!;
    }

    for (const citizenId of citizens) {
        const primaryScope = personToScope.get(citizenId);
        if (!primaryScope) continue;

        // Walk ancestor chain from primary scope
        let current: string | undefined = primaryScope;
        const visited = new Set<string>();
        while (current && !visited.has(current)) {
            visited.add(current);
            ensureSet(current).add(citizenId);
            current = scopeParent.get(current);
        }
    }

    return { citizens, personToScope, scopeParent, scopeToDescendantCitizens };
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * citizenShare(k) = |{c ∈ CIT : k is ancestor-or-self of MEM(c)}| / |CIT|
 *
 * Returns 0 when CIT is empty or k has no members.
 */
export function citizenShare(scopeId: string, index: MembershipIndex): number {
    const total = index.citizens.size;
    if (total === 0) return 0;
    const members = index.scopeToDescendantCitizens.get(scopeId)?.size ?? 0;
    return members / total;
}

/**
 * communeShare(F, k) = citizenShare(k) restricted to citizens in federation F.
 *
 * Equals |{c ∈ CIT_F : k is ancestor-or-self of MEM(c)}| / |CIT_F|
 * where CIT_F = citizens whose ancestor chain includes federation F.
 */
export function communeShare(
    federationId: string,
    scopeId: string,
    index: MembershipIndex,
): number {
    const federationCitizens = index.scopeToDescendantCitizens.get(federationId);
    if (!federationCitizens || federationCitizens.size === 0) return 0;

    const scopeCitizens = index.scopeToDescendantCitizens.get(scopeId);
    if (!scopeCitizens || scopeCitizens.size === 0) return 0;

    // Intersection: citizens in both federation and scope
    let intersection = 0;
    for (const c of scopeCitizens) {
        if (federationCitizens.has(c)) intersection++;
    }

    return intersection / federationCitizens.size;
}
