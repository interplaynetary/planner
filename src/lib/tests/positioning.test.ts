import { describe, it, expect, beforeEach } from 'bun:test';
import {
    routingGeometry,
    rankDecouplingCandidates,
    rankControlPointCandidates,
    decouplingTests,
} from '../algorithms/positioning';
import { RecipeStore } from '../knowledge/recipes';

// ─── helpers ──────────────────────────────────────────────────────────────────

let counter = 0;
const genId = () => `id-${++counter}`;

/**
 * Build a linear chain: A(aDays) → B(bDays) → C(cDays)
 *
 *   A produces spec-AB → B consumes spec-AB
 *   B produces spec-BC → C consumes spec-BC
 *   C produces spec-final (terminal)
 */
function buildLinearChain(aDays = 2, bDays = 3, cDays = 5, recipeId = 'recipe-linear'): RecipeStore {
    const rs = new RecipeStore(genId);
    rs.addRecipeProcess({ id: 'rp-A', name: 'A', hasDuration: { hasNumericalValue: aDays, hasUnit: 'days' } });
    rs.addRecipeProcess({ id: 'rp-B', name: 'B', hasDuration: { hasNumericalValue: bDays, hasUnit: 'days' } });
    rs.addRecipeProcess({ id: 'rp-C', name: 'C', hasDuration: { hasNumericalValue: cDays, hasUnit: 'days' } });

    rs.addRecipeFlow({ id: 'f-AB-out', action: 'produce',  recipeOutputOf: 'rp-A', resourceConformsTo: 'spec-AB' });
    rs.addRecipeFlow({ id: 'f-AB-in',  action: 'consume',  recipeInputOf:  'rp-B', resourceConformsTo: 'spec-AB' });
    rs.addRecipeFlow({ id: 'f-BC-out', action: 'produce',  recipeOutputOf: 'rp-B', resourceConformsTo: 'spec-BC' });
    rs.addRecipeFlow({ id: 'f-BC-in',  action: 'consume',  recipeInputOf:  'rp-C', resourceConformsTo: 'spec-BC' });
    rs.addRecipeFlow({ id: 'f-fin',    action: 'produce',  recipeOutputOf: 'rp-C', resourceConformsTo: 'spec-final' });

    rs.addRecipe({ id: recipeId, name: 'Linear', recipeProcesses: ['rp-A', 'rp-B', 'rp-C'], primaryOutput: 'spec-final' });
    return rs;
}

/**
 * Build a convergent (diamond) chain: A and B each feed C.
 *
 *   A produces spec-X → C consumes spec-X
 *   B produces spec-Y → C consumes spec-Y
 *   C produces spec-final (terminal)
 */
function buildConvergentChain(recipeId = 'recipe-conv'): RecipeStore {
    const rs = new RecipeStore(genId);
    rs.addRecipeProcess({ id: 'rp-A', name: 'A', hasDuration: { hasNumericalValue: 2, hasUnit: 'days' } });
    rs.addRecipeProcess({ id: 'rp-B', name: 'B', hasDuration: { hasNumericalValue: 3, hasUnit: 'days' } });
    rs.addRecipeProcess({ id: 'rp-C', name: 'C', hasDuration: { hasNumericalValue: 1, hasUnit: 'days' } });

    rs.addRecipeFlow({ id: 'f-AX',  action: 'produce', recipeOutputOf: 'rp-A', resourceConformsTo: 'spec-X' });
    rs.addRecipeFlow({ id: 'f-XC',  action: 'consume', recipeInputOf:  'rp-C', resourceConformsTo: 'spec-X' });
    rs.addRecipeFlow({ id: 'f-BY',  action: 'produce', recipeOutputOf: 'rp-B', resourceConformsTo: 'spec-Y' });
    rs.addRecipeFlow({ id: 'f-YC',  action: 'consume', recipeInputOf:  'rp-C', resourceConformsTo: 'spec-Y' });
    rs.addRecipeFlow({ id: 'f-fin', action: 'produce', recipeOutputOf: 'rp-C', resourceConformsTo: 'spec-final' });

    rs.addRecipe({ id: recipeId, name: 'Conv', recipeProcesses: ['rp-A', 'rp-B', 'rp-C'], primaryOutput: 'spec-final' });
    return rs;
}

/**
 * Build a divergent (fan-out) chain: A fans out to B and C.
 *
 *   A produces spec-X → B consumes spec-X
 *   A produces spec-Y → C consumes spec-Y
 *   B produces spec-Bfin (terminal)
 *   C produces spec-Cfin (terminal)
 */
function buildDivergentChain(recipeId = 'recipe-div'): RecipeStore {
    const rs = new RecipeStore(genId);
    rs.addRecipeProcess({ id: 'rp-A', name: 'A', hasDuration: { hasNumericalValue: 3, hasUnit: 'days' } });
    rs.addRecipeProcess({ id: 'rp-B', name: 'B', hasDuration: { hasNumericalValue: 2, hasUnit: 'days' } });
    rs.addRecipeProcess({ id: 'rp-C', name: 'C', hasDuration: { hasNumericalValue: 4, hasUnit: 'days' } });

    rs.addRecipeFlow({ id: 'f-AX',  action: 'produce', recipeOutputOf: 'rp-A', resourceConformsTo: 'spec-X' });
    rs.addRecipeFlow({ id: 'f-XB',  action: 'consume', recipeInputOf:  'rp-B', resourceConformsTo: 'spec-X' });
    rs.addRecipeFlow({ id: 'f-AY',  action: 'produce', recipeOutputOf: 'rp-A', resourceConformsTo: 'spec-Y' });
    rs.addRecipeFlow({ id: 'f-YC',  action: 'consume', recipeInputOf:  'rp-C', resourceConformsTo: 'spec-Y' });
    rs.addRecipeFlow({ id: 'f-Bf',  action: 'produce', recipeOutputOf: 'rp-B', resourceConformsTo: 'spec-Bfin' });
    rs.addRecipeFlow({ id: 'f-Cf',  action: 'produce', recipeOutputOf: 'rp-C', resourceConformsTo: 'spec-Cfin' });

    rs.addRecipe({ id: recipeId, name: 'Div', recipeProcesses: ['rp-A', 'rp-B', 'rp-C'] });
    return rs;
}

// ─── routingGeometry ─────────────────────────────────────────────────────────

describe('routingGeometry', () => {
    beforeEach(() => { counter = 0; });

    it('linear chain: correct upstream/downstream counts and flags', () => {
        const rs = buildLinearChain();
        const geom = routingGeometry('recipe-linear', rs);
        expect(geom).toHaveLength(3);

        const gA = geom.find(g => g.processId === 'rp-A')!;
        expect(gA.upstreamPathCount).toBe(0);
        expect(gA.downstreamPathCount).toBe(1);
        expect(gA.isConvergent).toBe(false);
        expect(gA.isDivergent).toBe(false);
        expect(gA.isGatingPoint).toBe(false);  // not terminal, no buffer output

        const gB = geom.find(g => g.processId === 'rp-B')!;
        expect(gB.upstreamPathCount).toBe(1);
        expect(gB.downstreamPathCount).toBe(1);
        expect(gB.isConvergent).toBe(false);
        expect(gB.isDivergent).toBe(false);
        expect(gB.isGatingPoint).toBe(false);

        const gC = geom.find(g => g.processId === 'rp-C')!;
        expect(gC.upstreamPathCount).toBe(1);
        expect(gC.downstreamPathCount).toBe(0);
        expect(gC.isConvergent).toBe(false);
        expect(gC.isDivergent).toBe(false);
        expect(gC.isGatingPoint).toBe(true);   // terminal
    });

    it('convergent (diamond): assembly point has upstreamPathCount=2, isConvergent=true', () => {
        const rs = buildConvergentChain();
        const geom = routingGeometry('recipe-conv', rs);

        const gC = geom.find(g => g.processId === 'rp-C')!;
        expect(gC.upstreamPathCount).toBe(2);
        expect(gC.isConvergent).toBe(true);
        expect(gC.isGatingPoint).toBe(true);

        // Feeds A and B have downstreamPathCount=1, not convergent
        const gA = geom.find(g => g.processId === 'rp-A')!;
        expect(gA.downstreamPathCount).toBe(1);
        expect(gA.isConvergent).toBe(false);

        const gB = geom.find(g => g.processId === 'rp-B')!;
        expect(gB.isConvergent).toBe(false);
    });

    it('divergent (fan-out): source has downstreamPathCount=2, isDivergent=true', () => {
        const rs = buildDivergentChain();
        const geom = routingGeometry('recipe-div', rs);

        const gA = geom.find(g => g.processId === 'rp-A')!;
        expect(gA.downstreamPathCount).toBe(2);
        expect(gA.isDivergent).toBe(true);
        expect(gA.isConvergent).toBe(false);
        expect(gA.isGatingPoint).toBe(false);  // not terminal

        // B and C are terminal → gating points
        const gB = geom.find(g => g.processId === 'rp-B')!;
        expect(gB.isGatingPoint).toBe(true);

        const gC = geom.find(g => g.processId === 'rp-C')!;
        expect(gC.isGatingPoint).toBe(true);
    });

    it('returns empty array for unknown recipe', () => {
        const rs = new RecipeStore(genId);
        expect(routingGeometry('no-such-recipe', rs)).toEqual([]);
    });
});

// ─── rankDecouplingCandidates ─────────────────────────────────────────────────

describe('rankDecouplingCandidates', () => {
    // Chain: A(2d) → B(3d) → C(5d), total CLT = 10d
    // Candidate A: decoupledDlt = downstreamDlt(B) = B(3)+C(5) = 8 → compression = 20%
    // Candidate B: decoupledDlt = downstreamDlt(C) = C(5)          = 5 → compression = 50%
    // positioningScore: A = 20*0.5 = 10, B = 50*0.5 = 25

    beforeEach(() => { counter = 0; });

    it('ranks candidates descending by positioningScore', () => {
        const rs = buildLinearChain(2, 3, 5);
        const results = rankDecouplingCandidates('recipe-linear', rs);

        expect(results.length).toBeGreaterThanOrEqual(2);
        // Highest score first
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].positioningScore).toBeGreaterThanOrEqual(results[i].positioningScore);
        }

        // B (closer to end) has higher compressionPct and score than A
        const rB = results.find(r => r.processId === 'rp-B')!;
        const rA = results.find(r => r.processId === 'rp-A')!;
        expect(rB.positioningScore).toBeGreaterThan(rA.positioningScore);
        expect(rB.compressionPct).toBeCloseTo(50, 1);
        expect(rA.compressionPct).toBeCloseTo(20, 1);
    });

    it('exclusion filter removes already-buffered specs', () => {
        const rs = buildLinearChain(2, 3, 5);
        const excluded = new Set(['spec-BC']);  // exclude B's output spec
        const results = rankDecouplingCandidates('recipe-linear', rs, excluded);

        const ids = results.map(r => r.processId);
        expect(ids).not.toContain('rp-B');
        expect(ids).toContain('rp-A');
    });

    it('variabilityByStage raises positioningScore of high-variability process', () => {
        const rs = buildLinearChain(2, 3, 5);
        // Give rp-A variability=80 → score = 20*0.5 + 80*0.2 = 10+16 = 26 > rp-B(25)
        const variability = new Map([['rp-A', 80]]);
        const results = rankDecouplingCandidates('recipe-linear', rs, undefined, variability);

        const rA = results.find(r => r.processId === 'rp-A')!;
        expect(rA.positioningScore).toBeCloseTo(26, 1);
        // rp-A now beats rp-B
        expect(results[0].processId).toBe('rp-A');
    });

    it('leverageScore increases positioningScore when spec is shared across recipes', () => {
        const rs = buildLinearChain(2, 3, 5, 'r-1');
        // Add a second recipe that also consumes spec-AB
        rs.addRecipeProcess({ id: 'rp-D', name: 'D', hasDuration: { hasNumericalValue: 1, hasUnit: 'days' } });
        rs.addRecipeFlow({ id: 'f-D-in', action: 'consume', recipeInputOf: 'rp-D', resourceConformsTo: 'spec-AB' });
        rs.addRecipeFlow({ id: 'f-D-out', action: 'produce', recipeOutputOf: 'rp-D', resourceConformsTo: 'spec-D' });
        rs.addRecipe({ id: 'r-2', name: 'Other', recipeProcesses: ['rp-D'] });

        const results = rankDecouplingCandidates('r-1', rs);
        const rA = results.find(r => r.processId === 'rp-A')!;
        // leverageScore = 1 (r-2 also uses spec-AB)
        expect(rA.leverageScore).toBe(1);
        // leverage bonus = min(1*10, 30) = 10 → positioningScore ≥ 20
        expect(rA.positioningScore).toBeGreaterThanOrEqual(20);
    });
});

// ─── rankControlPointCandidates ──────────────────────────────────────────────

describe('rankControlPointCandidates', () => {
    beforeEach(() => { counter = 0; });

    it('terminal gating point has highest score in linear chain', () => {
        const rs = buildLinearChain();
        const results = rankControlPointCandidates('recipe-linear', rs);

        expect(results[0].processId).toBe('rp-C');  // isGatingPoint=true → score ≥ 2
        expect(results[0].isGatingPoint).toBe(true);
        expect(results[0].placementScore).toBeGreaterThanOrEqual(2);
    });

    it('pacing resource (instability ≥ 80) beats convergent point', () => {
        const rs = buildConvergentChain();
        // rp-C is convergent+gating (score=4), rp-A with instability=90 → score=3+0+0+0+2=5
        const instability = new Map([['rp-A', 90]]);
        const results = rankControlPointCandidates('recipe-conv', rs, instability);

        const rA = results.find(r => r.processId === 'rp-A')!;
        expect(rA.isPacingResource).toBe(true);
        expect(rA.placementScore).toBeGreaterThanOrEqual(5);

        const rC = results.find(r => r.processId === 'rp-C')!;
        expect(rA.placementScore).toBeGreaterThan(rC.placementScore);
    });

    it('convergent assembly point scores higher than non-convergent in diamond', () => {
        const rs = buildConvergentChain();
        const results = rankControlPointCandidates('recipe-conv', rs);

        const rC = results.find(r => r.processId === 'rp-C')!;
        const rA = results.find(r => r.processId === 'rp-A')!;
        const rB = results.find(r => r.processId === 'rp-B')!;

        expect(rC.isConvergent).toBe(true);
        expect(rC.placementScore).toBeGreaterThan(rA.placementScore);
        expect(rC.placementScore).toBeGreaterThan(rB.placementScore);
    });

    it('instabilityScore is computed from caller-supplied instability value', () => {
        const rs = buildLinearChain();
        // instability=67 → floor(67/33.4)=2
        const instability = new Map([['rp-B', 67]]);
        const results = rankControlPointCandidates('recipe-linear', rs, instability);

        const rB = results.find(r => r.processId === 'rp-B')!;
        // instabilityScore=2, no gating/convergent/divergent → placementScore=2
        expect(rB.placementScore).toBe(2);
        expect(rB.isPacingResource).toBe(false);  // 67 < 80
    });
});

// ─── decouplingTests ─────────────────────────────────────────────────────────

describe('decouplingTests', () => {
    // Chain: A(4d) → B(4d) → C(4d), total CLT = 12d
    beforeEach(() => { counter = 0; });

    function buildEqualChain(recipeId = 'r-equal') {
        return buildLinearChain(4, 4, 4, recipeId);
    }

    it('all 6 tests pass for a well-positioned midpoint buffer (rp-B)', () => {
        const rs = buildEqualChain();
        // rp-B: decoupledDlt=4, fullClt=12, compressionPct=67%, horizon=12*0.6=7.2
        const result = decouplingTests('r-equal', 'rp-B', rs, { variabilityFactor: 0.3 });

        expect(result.decouplesHorizon).toBe(true);       // 4 < 7.2
        expect(result.biDirectionalBenefit).toBe(true);   // upstream=8 > 0, downstream=4 > 0
        expect(result.orderIndependence).toBe(true);       // no time bufferType
        expect(result.isPrimaryPlanningMechanism).toBe(true); // no existing CPs
        expect(result.relativePriorityMet).toBe(true);    // 4/12=0.33 ≤ 0.6
        expect(result.dynamicAdjustmentReady).toBe(true); // 0.3 ≤ 0.5
        expect(result.testsPassed).toBe(6);
    });

    it('decouplesHorizon=false when customerHorizonDays is tighter than decoupledDlt', () => {
        const rs = buildEqualChain();
        // customerHorizonDays=3, decoupledDlt=4 → 4 < 3 is false
        const result = decouplingTests('r-equal', 'rp-B', rs, { customerHorizonDays: 3 });
        expect(result.decouplesHorizon).toBe(false);
        expect(result.testsPassed).toBe(5);
    });

    it('relativePriorityMet=false when too much CLT remains downstream (rp-A)', () => {
        const rs = buildEqualChain();
        // rp-A: decoupledDlt = downstreamDlt(rp-B) = 4+4 = 8, ratio=8/12=0.667 > 0.6
        const result = decouplingTests('r-equal', 'rp-A', rs);
        expect(result.relativePriorityMet).toBe(false);
    });

    it('dynamicAdjustmentReady=false when variabilityFactor > 0.5', () => {
        const rs = buildEqualChain();
        const result = decouplingTests('r-equal', 'rp-B', rs, { variabilityFactor: 0.6 });
        expect(result.dynamicAdjustmentReady).toBe(false);
    });

    it('isPrimaryPlanningMechanism=false when existing downstream control point set', () => {
        const rs = buildEqualChain();
        // rp-C is downstream of rp-B; declaring it as existing CP kills test 4
        const result = decouplingTests('r-equal', 'rp-B', rs, {
            existingControlPoints: ['rp-C'],
        });
        expect(result.isPrimaryPlanningMechanism).toBe(false);
    });

    it('biDirectionalBenefit=false for terminal process (no downstream leg)', () => {
        const rs = buildEqualChain();
        // rp-C is terminal: decoupledDlt=0, upstreamDays=12 → biDir=false (decoupledDlt=0)
        const result = decouplingTests('r-equal', 'rp-C', rs);
        expect(result.biDirectionalBenefit).toBe(false);
    });
});
