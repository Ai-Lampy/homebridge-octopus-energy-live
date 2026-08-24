import type { MeterSide } from './accessory';

export function livePowerForSide(side: MeterSide, signedDemandWatts: number): number {
  return side === 'import' ? Math.max(0, signedDemandWatts) : Math.max(0, -signedDemandWatts);
}

export function wattsToMatterMilliwatts(watts: number): number {
  return Math.round((Number.isFinite(watts) ? Math.max(0, watts) : 0) * 1000);
}

export function kWhToMatterMilliwattHours(kWh: number): number {
  return Math.round((Number.isFinite(kWh) ? Math.max(0, kWh) : 0) * 1_000_000);
}

export interface MatterCumulativeEnergyMeasurement {
  energy: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface TrackedCumulativeEnergy {
  totalKWh: number;
  lastIntervalEnd: string;
}

export function advanceCumulativeEnergy(
  previousTotalKWh: number,
  previousIntervalEnd: string | undefined,
  intervalKWh: number,
  intervalEnd: Date,
  initialTotalKWh: number,
): TrackedCumulativeEnergy {
  const currentEnd = intervalEnd.toISOString();
  const previousEndMs = previousIntervalEnd ? new Date(previousIntervalEnd).getTime() : Number.NaN;
  const safeIntervalKWh = Number.isFinite(intervalKWh) ? Math.max(0, intervalKWh) : 0;
  const safeInitialTotalKWh = Number.isFinite(initialTotalKWh) ? Math.max(0, initialTotalKWh) : 0;

  if (!Number.isFinite(previousTotalKWh) || previousTotalKWh <= 0 || !previousIntervalEnd) {
    return {
      totalKWh: Math.max(safeInitialTotalKWh, safeIntervalKWh),
      lastIntervalEnd: currentEnd,
    };
  }

  if (!Number.isNaN(previousEndMs) && intervalEnd.getTime() <= previousEndMs) {
    return { totalKWh: previousTotalKWh, lastIntervalEnd: previousIntervalEnd };
  }

  return {
    totalKWh: Math.round((previousTotalKWh + safeIntervalKWh) * 1_000_000) / 1_000_000,
    lastIntervalEnd: currentEnd,
  };
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

export function buildMatterDailyEnergyMeasurement(
  kWh: number,
  observedAt = new Date(),
): MatterCumulativeEnergyMeasurement {
  const validObservedAt = Number.isNaN(observedAt.getTime()) ? new Date() : observedAt;
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(validObservedAt);
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(
    dateParts.find((part) => part.type === type)?.value,
  );
  const utcGuess = Date.UTC(value('year'), value('month') - 1, value('day'));
  const hourAtGuess = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcGuess)));
  const start = new Date(utcGuess - hourAtGuess * 60 * 60_000);
  const startTimestamp = Math.floor(start.getTime() / 1000);
  const endTimestamp = Math.max(startTimestamp + 1, Math.floor(validObservedAt.getTime() / 1000));

  return {
    energy: kWhToMatterMilliwattHours(kWh),
    startTimestamp,
    endTimestamp,
  };
}
