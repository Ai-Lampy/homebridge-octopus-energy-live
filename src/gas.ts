export type GasConsumptionUnit = 'kWh' | 'm³';

export const GAS_POLL_INTERVAL_MS = 30 * 60_000;

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
