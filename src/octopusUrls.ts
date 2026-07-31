export interface TodayUrlOptions {
  now?: Date;
  pageSize?: number;
}

export function buildLatestConsumptionUrl(mpan: string, serial: string): string {
  const safeMpan = encodeURIComponent(mpan.trim());
  const safeSerial = encodeURIComponent(serial.trim());
  const params = new URLSearchParams({
    page_size: '1',
    order_by: '-period',
  });

  return `https://api.octopus.energy/v1/electricity-meter-points/${safeMpan}/meters/${safeSerial}/consumption/?${params.toString()}`;
}

export function buildTodayConsumptionUrl(mpan: string, serial: string, options: TodayUrlOptions = {}): string {
  const safeMpan = encodeURIComponent(mpan.trim());
  const safeSerial = encodeURIComponent(serial.trim());
  const now = options.now ?? new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

  const params = new URLSearchParams({
    page_size: String(options.pageSize ?? 250),
    order_by: 'period',
    period_from: start.toISOString(),
  });

  return `https://api.octopus.energy/v1/electricity-meter-points/${safeMpan}/meters/${safeSerial}/consumption/?${params.toString()}`;
}
