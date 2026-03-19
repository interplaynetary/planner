import type { ResourceSpecification } from '$lib/schemas';

export type BufferType = 'ecological' | 'strategic' | 'reserve' | 'social' | 'consumption' | 'metabolic';

export type ResponseTime = 'SEASONS' | 'MONTHS' | 'WEEKS' | 'DAYS' | 'ONGOING' | 'EMERGENCY';

export function getResponseTime(type: BufferType): ResponseTime {
  switch (type) {
    case 'ecological':  return 'SEASONS';
    case 'strategic':   return 'MONTHS';
    case 'reserve':     return 'EMERGENCY';
    case 'social':      return 'ONGOING';
    case 'metabolic':
    case 'consumption': return 'DAYS';
    default:            return 'DAYS';
  }
}

export const TIER_PRIORITY: Record<BufferType, number> = {
    ecological:  0,
    strategic:   1,
    reserve:     2,
    metabolic:   3,
    consumption: 4,
    social:      5,
};

export function bufferTypeFromTags(tags: string[]): BufferType {
    if (tags.includes('tag:buffer:ecological'))  return 'ecological';
    if (tags.includes('tag:buffer:strategic'))   return 'strategic';
    if (tags.includes('tag:buffer:reserve'))     return 'reserve';
    if (tags.includes('tag:buffer:social'))      return 'social';
    if (tags.includes('tag:buffer:consumption')) return 'consumption';
    return 'metabolic';
}

export function compositeBufferPriority(
    tier: BufferType,
    zone: 'red' | 'yellow' | 'green' | 'excess',
): number {
    const ZONE_ORD: Record<string, number> = { red: 0, yellow: 1, green: 2, excess: 3 };
    return TIER_PRIORITY[tier] * 10 + (ZONE_ORD[zone] ?? 3);
}

export function getBufferType(specId: string, resourceSpecs: ResourceSpecification[]): BufferType {
    const spec = resourceSpecs.find(s => s.id === specId);
    return bufferTypeFromTags(spec?.resourceClassifiedAs ?? []);
}
