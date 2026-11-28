export const OCTOPUS_API_BASE = 'https://api.oegb-kraken.energy/v1';

export function normaliseDeviceId(value: string): string {
  const compact = value.trim().replace(/[-:]/g, '');
  if (!/^[0-9a-f]{16}$/i.test(compact)) {
    throw new Error('Invalid smart-meter EUI64 device ID. Clear the manual override to use account discovery; do not enter an MPAN or printed serial number.');
  }
  return compact.toUpperCase().match(/.{2}/g)!.join('-');
}

export function isFreshTelemetry(readAt: string | undefined, now = Date.now()): boolean {
  const time = readAt ? Date.parse(readAt) : Number.NaN;
  return Number.isFinite(time) && time <= now + 60_000 && now - time <= 5 * 60_000;
}

// Daily aggregates must never replace a lifetime register. Keep the previous
// register through fallback and ignore backwards/reset readings until reviewed.
export function lifetimeEnergy(previous: number | undefined, next: number, isLifetime: boolean): number | undefined {
  if (!isLifetime || !Number.isFinite(next) || next < 0) {
    return previous;
  }
  return Math.max(previous ?? 0, next);
}
