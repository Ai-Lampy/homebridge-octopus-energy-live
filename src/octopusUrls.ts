export interface TodayUrlOptions {
  now?: Date;
  pageSize?: number;
}

type MeterFuel = 'electricity' | 'gas';

function buildConsumptionUrl(
  fuel: MeterFuel,
  meterPoint: string,
  serial: string,
  params: URLSearchParams,
): string {
  const safeMeterPoint = encodeURIComponent(meterPoint.trim());
  const safeSerial = encodeURIComponent(serial.trim());
  return `https://api.octopus.energy/v1/${fuel}-meter-points/${safeMeterPoint}/meters/${safeSerial}/consumption/?${params.toString()}`;
}

export function buildLatestConsumptionUrl(mpan: string, serial: string): string {
  const params = new URLSearchParams({
    page_size: '1',
    order_by: '-period',
  });

  return buildConsumptionUrl('electricity', mpan, serial, params);
}

export function buildTodayConsumptionUrl(mpan: string, serial: string, options: TodayUrlOptions = {}): string {
  const now = options.now ?? new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

  const params = new URLSearchParams({
    page_size: String(options.pageSize ?? 250),
    order_by: 'period',
    period_from: start.toISOString(),
  });

  return buildConsumptionUrl('electricity', mpan, serial, params);
}

export function buildLatestGasConsumptionUrl(mprn: string, serial: string): string {
  const params = new URLSearchParams({
    page_size: '1',
    order_by: '-period',
  });

  return buildConsumptionUrl('gas', mprn, serial, params);
}

export function buildTodayGasConsumptionUrl(mprn: string, serial: string, options: TodayUrlOptions = {}): string {
  const now = options.now ?? new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const params = new URLSearchParams({
    page_size: String(options.pageSize ?? 250),
    order_by: 'period',
    period_from: start.toISOString(),
  });

  return buildConsumptionUrl('gas', mprn, serial, params);
}
