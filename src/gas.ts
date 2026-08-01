export type GasConsumptionUnit = 'kWh' | 'm³';

export const GAS_POLL_INTERVAL_MS = 30 * 60_000;
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
