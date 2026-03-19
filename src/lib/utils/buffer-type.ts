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

export function getBufferType(specId: string, resourceSpecs: ResourceSpecification[]): BufferType {
    const spec = resourceSpecs.find(s => s.id === specId);
    const tags = spec?.resourceClassifiedAs ?? [];
    if (tags.includes('tag:buffer:ecological')) return 'ecological';
    if (tags.includes('tag:buffer:strategic'))  return 'strategic';
    if (tags.includes('tag:buffer:reserve'))    return 'reserve';
    if (tags.includes('tag:buffer:social'))     return 'social';
    if (tags.includes('tag:buffer:consumption')) return 'consumption';
    return 'metabolic';
}
