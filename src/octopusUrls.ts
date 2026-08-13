export interface TodayUrlOptions {
  now?: Date;
  pageSize?: number;
}

type MeterFuel = 'electricity' | 'gas';

function ukDayStart(now: Date): Date {
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(
    dateParts.find((candidate) => candidate.type === type)?.value,
  );
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const hourAtGuess = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcGuess)));

  return new Date(utcGuess - hourAtGuess * 60 * 60_000);
}

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
  const start = ukDayStart(now);

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
  const start = ukDayStart(now);
  const params = new URLSearchParams({
    page_size: String(options.pageSize ?? 250),
    order_by: 'period',
    period_from: start.toISOString(),
  });

  return buildConsumptionUrl('gas', mprn, serial, params);
}
