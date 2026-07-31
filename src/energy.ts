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

export interface MatterCumulativeEnergyMeasurement {
  energy: number;
  endTimestamp?: number;
}

export function buildMatterCumulativeEnergyMeasurement(
  kWh: number,
  readAt: Date | undefined,
  isLifetimeTotal: boolean,
): MatterCumulativeEnergyMeasurement {
  const measurement: MatterCumulativeEnergyMeasurement = {
    energy: kWhToMatterMilliwattHours(kWh),
  };

  // Matter requires cumulative measurements to omit startTimestamp. The REST
  // fallback is a daily aggregate and its latest interval may be from an
  // earlier day, so attaching that timestamp can also produce an invalid
  // end-before-start range. Only timestamp a true lifetime register value.
  if (isLifetimeTotal && readAt && !Number.isNaN(readAt.getTime())) {
    measurement.endTimestamp = Math.floor(readAt.getTime() / 1000);
  }
  return measurement;
}
