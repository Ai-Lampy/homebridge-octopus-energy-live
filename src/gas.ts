export type GasConsumptionUnit = 'kWh' | 'm³';

export interface GasTelemetrySample {
  readAt?: string;
  consumption?: string | number;
  consumptionDelta?: string | number;
  demand?: string | number;
}

export interface ParsedGasTelemetry {
  intervalKWh: number;
  todayKWh: number;
  cumulativeKWh: number;
  demandWatts: number;
  periodEnd: Date;
}

export const DEFAULT_GAS_POLL_MINUTES = 5;
export const MINIMUM_GAS_POLL_MINUTES = 5;
export const MAXIMUM_GAS_POLL_MINUTES = 30;

export function gasPollIntervalMs(minutes: number | undefined): number {
  const requested = Number.isFinite(minutes) ? Number(minutes) : DEFAULT_GAS_POLL_MINUTES;
  return Math.min(MAXIMUM_GAS_POLL_MINUTES, Math.max(MINIMUM_GAS_POLL_MINUTES, requested)) * 60_000;
}
export const GAS_VOLUME_CORRECTION_FACTOR = 1.02264;
export const DEFAULT_GAS_CALORIFIC_VALUE = 39.2;

export function gasConsumptionToKWh(
  consumption: number,
  unit: GasConsumptionUnit,
  calorificValue = DEFAULT_GAS_CALORIFIC_VALUE,
): number {
  const safeConsumption = Math.max(0, consumption);
  if (unit === 'kWh') {
    return safeConsumption;
  }

  // UK gas meters measure volume. Energy suppliers convert it using:
  // volume × correction factor × calorific value ÷ 3.6.
  return safeConsumption * GAS_VOLUME_CORRECTION_FACTOR * calorificValue / 3.6;
}

export function normaliseGasConsumptionUnit(unit: string | undefined): GasConsumptionUnit {
  const normalised = unit?.trim().toLowerCase().replace(/\s/g, '');
  if (normalised === 'kwh') {
    return 'kWh';
  }
  if (normalised === 'm3' || normalised === 'm³' || normalised === 'cubicmetres' || normalised === 'cubicmeters') {
    return 'm³';
  }
  throw new Error(`Octopus returned an unknown gas consumption unit${unit ? `: ${unit}` : ''}`);
}

export function parseGasTelemetry(samples: GasTelemetrySample[]): ParsedGasTelemetry {
  const readings = samples
    .map((sample) => ({
      sample,
      readAt: sample.readAt ? new Date(sample.readAt) : undefined,
      consumptionWh: finiteNumber(sample.consumption),
    }))
    .filter((reading) => reading.readAt && !Number.isNaN(reading.readAt.getTime()) && reading.consumptionWh !== undefined)
    .sort((left, right) => left.readAt!.getTime() - right.readAt!.getTime());

  if (readings.length < 2) {
    throw new Error('Not enough Home Mini gas telemetry returned to calculate today\'s usage');
  }

  const first = readings[0];
  const latest = readings[readings.length - 1];
  const previous = readings[readings.length - 2];
  const reportedDelta = finiteNumber(latest.sample.consumptionDelta);
  const intervalWh = reportedDelta ?? Math.max(0, latest.consumptionWh! - previous.consumptionWh!);

  return {
    intervalKWh: roundKWh(intervalWh / 1000),
    todayKWh: roundKWh(Math.max(0, latest.consumptionWh! - first.consumptionWh!) / 1000),
    cumulativeKWh: roundKWh(Math.max(0, latest.consumptionWh!) / 1000),
    demandWatts: Math.max(0, finiteNumber(latest.sample.demand) ?? 0),
    periodEnd: latest.readAt!,
  };
}

function finiteNumber(value: string | number | undefined): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundKWh(value: number): number {
  return Math.round(value * 1000) / 1000;
}
