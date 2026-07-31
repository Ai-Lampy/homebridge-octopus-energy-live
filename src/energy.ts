import type { MeterSide } from './accessory';

export function livePowerForSide(side: MeterSide, signedDemandWatts: number): number {
  return side === 'import' ? Math.max(0, signedDemandWatts) : Math.max(0, -signedDemandWatts);
}

export function wattsToMatterMilliwatts(watts: number): number {
  return Math.round(Math.max(0, watts) * 1000);
}

export function kWhToMatterMilliwattHours(kWh: number): number {
  return Math.round(Math.max(0, kWh) * 1_000_000);
}
