import fetch, { RequestInit, Response } from 'node-fetch';
import { Logger } from 'homebridge';
import {
  buildLatestConsumptionUrl,
  buildLatestGasConsumptionUrl,
  buildTodayConsumptionUrl,
  buildTodayGasConsumptionUrl,
} from './octopusUrls';
import { ukDayStart } from './octopusUrls';
import {
  GasConsumptionUnit,
  GasTelemetrySample,
  normaliseGasConsumptionUnit,
  parseGasTelemetry,
} from './gas';

const GRAPHQL_URL = 'https://api.octopus.energy/v1/graphql/';
const OCTOPUS_REQUEST_TIMEOUT_MS = 20_000;

interface ConsumptionRecord {
  consumption?: number;
  interval_start?: string;
  interval_end?: string;
  period_start?: string;
  period_end?: string;
}

interface ConsumptionResponse {
  results?: ConsumptionRecord[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface TokenResponse {
  obtainKrakenToken?: {
    token?: string;
  };
}

interface TelemetryResponse {
  smartMeterTelemetry?: Array<GasTelemetrySample & { export?: string | number }>;
}

interface AccountMetersResponse {
  account?: {
    electricityAgreements?: Array<{
      meterPoint?: {
        mpan?: string;
        meters?: Array<{
          serialNumber?: string;
          smartImportElectricityMeter?: { deviceId?: string };
        }>;
      };
    }>;
  };
}

interface AccountGasMetersResponse {
  account?: {
    gasAgreements?: Array<{
      meterPoint?: {
        mprn?: string;
        meters?: Array<{
          serialNumber?: string;
          consumptionUnits?: string;
          smartGasMeter?: { deviceId?: string };
        }>;
      };
    }>;
  };
}

export interface LiveTelemetry {
  readAt?: string;
  demandWatts: number;
  importedWh?: number;
  exportedWh?: number;
}

export interface IntervalReading {
  watts: number;
  totalKWh: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface GasIntervalReading {
  intervalConsumption: number;
  totalConsumption: number;
  periodStart: Date;
  periodEnd: Date;
  valuesAreKWh?: boolean;
  cumulativeKWh?: number;
  demandWatts?: number;
}

export interface GasMeterDetails {
  unit: GasConsumptionUnit;
  deviceId?: string;
}

export class OctopusApiClient {
  private token?: string;
  private tokenPromise?: Promise<string>;
  private tokenExpiresAt = 0;
  private readonly telemetryCache = new Map<string, { fetchedAt: number; promise: Promise<LiveTelemetry> }>();
  private readonly intervalCache = new Map<string, { fetchedAt: number; promise: Promise<IntervalReading> }>();
  private readonly gasIntervalCache = new Map<string, { fetchedAt: number; promise: Promise<GasIntervalReading> }>();

  constructor(
    private readonly apiKey: string,
    private readonly log: Logger,
  ) {}

  public async discoverElectricityDeviceId(accountNumber: string, mpan: string, meterSerial: string): Promise<string> {
    const query = `
      query AccountMeterDevices($accountNumber: String!) {
        account(accountNumber: $accountNumber) {
          electricityAgreements(active: true) {
            meterPoint {
              mpan
              meters(includeInactive: false) {
                serialNumber
                smartImportElectricityMeter { deviceId }
              }
            }
          }
        }
      }
    `;
    const payload = await this.fetchGraphQL<AccountMetersResponse>(query, { accountNumber: accountNumber.trim() });
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message ?? 'GraphQL error').join('; '));
    }

    const wantedMpan = mpan.replace(/\s/g, '');
    const wantedSerial = meterSerial.replace(/\s/g, '').toUpperCase();
    for (const agreement of payload.data?.account?.electricityAgreements ?? []) {
      const meterPoint = agreement.meterPoint;
      if (meterPoint?.mpan?.replace(/\s/g, '') !== wantedMpan) {
        continue;
      }
      for (const meter of meterPoint.meters ?? []) {
        if (meter.serialNumber?.replace(/\s/g, '').toUpperCase() !== wantedSerial) {
          continue;
        }
        const deviceId = meter.smartImportElectricityMeter?.deviceId;
        if (deviceId) {
          return deviceId;
        }
      }
    }
    throw new Error('No smart electricity device ID matched the configured MPAN and meter serial');
  }

  public async discoverGasMeterDetails(
    accountNumber: string,
    mprn: string,
    meterSerial: string,
  ): Promise<GasMeterDetails> {
    const query = `
      query AccountGasMeters($accountNumber: String!) {
        account(accountNumber: $accountNumber) {
          gasAgreements(active: true) {
            meterPoint {
              mprn
              meters(includeInactive: false) {
                serialNumber
                consumptionUnits
                smartGasMeter { deviceId }
              }
            }
          }
        }
      }
    `;
    const payload = await this.fetchGraphQL<AccountGasMetersResponse>(query, { accountNumber: accountNumber.trim() });
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message ?? 'GraphQL error').join('; '));
    }

    const wantedMprn = mprn.replace(/\s/g, '');
    const wantedSerial = meterSerial.replace(/\s/g, '').toUpperCase();
    for (const agreement of payload.data?.account?.gasAgreements ?? []) {
      const meterPoint = agreement.meterPoint;
      if (meterPoint?.mprn?.replace(/\s/g, '') !== wantedMprn) {
        continue;
      }
      for (const meter of meterPoint.meters ?? []) {
        if (meter.serialNumber?.replace(/\s/g, '').toUpperCase() !== wantedSerial) {
          continue;
        }
        return {
          unit: normaliseGasConsumptionUnit(meter.consumptionUnits),
          deviceId: meter.smartGasMeter?.deviceId,
        };
      }
    }
    throw new Error('No active gas meter matched the configured MPRN and meter serial');
  }

  public async discoverGasConsumptionUnit(
    accountNumber: string,
    mprn: string,
    meterSerial: string,
  ): Promise<GasConsumptionUnit> {
    return (await this.discoverGasMeterDetails(accountNumber, mprn, meterSerial)).unit;
  }

  public async fetchLiveTelemetry(deviceId: string): Promise<LiveTelemetry> {
    // Import and export accessories poll together. Coalesce their requests so a
    // Home Mini only consumes one Octopus API call per polling interval.
    const cacheKey = deviceId.trim().toUpperCase();
    const cached = this.telemetryCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 5000) {
      return cached.promise;
    }

    const request = this.fetchLiveTelemetryUncached(deviceId);
    this.telemetryCache.set(cacheKey, { fetchedAt: Date.now(), promise: request });
    const clearRequest = () => {
      setTimeout(() => {
        if (this.telemetryCache.get(cacheKey)?.promise === request) {
          this.telemetryCache.delete(cacheKey);
        }
      }, 5000);
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  public async fetchGasLiveReading(deviceId: string): Promise<GasIntervalReading> {
    const now = new Date();
    const query = `
      query SmartGasMeterTelemetry(
        $deviceId: String!,
        $start: DateTime!,
        $end: DateTime!,
        $grouping: TelemetryGrouping!
      ) {
        smartMeterTelemetry(deviceId: $deviceId, start: $start, end: $end, grouping: $grouping) {
          readAt
          consumption
          consumptionDelta
          demand
        }
      }
    `;
    const variables = {
      deviceId: deviceId.trim(),
      start: ukDayStart(now).toISOString(),
      end: now.toISOString(),
      grouping: 'FIVE_MINUTES',
    };
    let payload = await this.fetchGraphQL<TelemetryResponse>(query, variables);
    if (payload.errors?.length && this.isAuthenticationError(payload.errors)) {
      this.token = undefined;
      payload = await this.fetchGraphQL<TelemetryResponse>(query, variables);
    }
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message ?? 'GraphQL error').join('; '));
    }

    const parsed = parseGasTelemetry(payload.data?.smartMeterTelemetry ?? []);
    return {
      intervalConsumption: parsed.intervalKWh,
      totalConsumption: parsed.todayKWh,
      periodStart: ukDayStart(now),
      periodEnd: parsed.periodEnd,
      valuesAreKWh: true,
      cumulativeKWh: parsed.cumulativeKWh,
      demandWatts: parsed.demandWatts,
    };
  }

  public async fetchIntervalReading(mpan: string, meterSerial: string): Promise<IntervalReading> {
    const cacheKey = `${mpan.trim()}-${meterSerial.trim()}`;
    const cached = this.intervalCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
      return cached.promise;
    }

    const promise = this.fetchIntervalReadingUncached(mpan, meterSerial);
    this.intervalCache.set(cacheKey, { fetchedAt: Date.now(), promise });
    void promise.catch(() => {
      if (this.intervalCache.get(cacheKey)?.promise === promise) {
        this.intervalCache.delete(cacheKey);
      }
    });
    return promise;
  }

  public async fetchGasIntervalReading(mprn: string, meterSerial: string): Promise<GasIntervalReading> {
    const cacheKey = `${mprn.trim()}-${meterSerial.trim()}`;
    const cached = this.gasIntervalCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 4 * 60_000) {
      return cached.promise;
    }

    const promise = this.fetchGasIntervalReadingUncached(mprn, meterSerial);
    this.gasIntervalCache.set(cacheKey, { fetchedAt: Date.now(), promise });
    void promise.catch(() => {
      if (this.gasIntervalCache.get(cacheKey)?.promise === promise) {
        this.gasIntervalCache.delete(cacheKey);
      }
    });
    return promise;
  }

  private async fetchIntervalReadingUncached(mpan: string, meterSerial: string): Promise<IntervalReading> {
    const now = new Date();
    const totalStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const [latestResponse, todayResponse] = await Promise.all([
      this.fetchRest(buildLatestConsumptionUrl(mpan, meterSerial)),
      this.fetchRest(buildTodayConsumptionUrl(mpan, meterSerial, { now })),
    ]);

    const latest = latestResponse.results?.[0];
    if (!latest || typeof latest.consumption !== 'number') {
      throw new Error('No consumption records returned');
    }

    const periodStart = new Date(latest.interval_start ?? latest.period_start ?? Date.now());
    const periodEnd = new Date(latest.interval_end ?? latest.period_end ?? Date.now());
    const intervalHours = periodEnd.getTime() > periodStart.getTime()
      ? (periodEnd.getTime() - periodStart.getTime()) / 3_600_000
      : 0.5;
    const watts = Math.max(0, (latest.consumption * 1000) / intervalHours);
    const totalKWh = (todayResponse.results ?? []).reduce((total, record) => (
      total + (typeof record.consumption === 'number' ? record.consumption : 0)
    ), 0);

    return {
      watts: Math.round(watts * 100) / 100,
      totalKWh: Math.max(0, Math.round(totalKWh * 1000) / 1000),
      periodStart: totalStart,
      periodEnd,
    };
  }

  private async fetchGasIntervalReadingUncached(mprn: string, meterSerial: string): Promise<GasIntervalReading> {
    const now = new Date();
    const totalStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const [latestResponse, todayResponse] = await Promise.all([
      this.fetchRest(buildLatestGasConsumptionUrl(mprn, meterSerial)),
      this.fetchRest(buildTodayGasConsumptionUrl(mprn, meterSerial, { now })),
    ]);

    const latest = latestResponse.results?.[0];
    if (!latest || typeof latest.consumption !== 'number') {
      throw new Error('No gas consumption records returned');
    }

    const periodEnd = new Date(latest.interval_end ?? latest.period_end ?? Date.now());
    const totalConsumption = (todayResponse.results ?? []).reduce((total, record) => (
      total + (typeof record.consumption === 'number' ? record.consumption : 0)
    ), 0);

    return {
      intervalConsumption: Math.max(0, Math.round(latest.consumption * 1000) / 1000),
      totalConsumption: Math.max(0, Math.round(totalConsumption * 1000) / 1000),
      periodStart: totalStart,
      periodEnd,
    };
  }

  private async fetchLiveTelemetryUncached(deviceId: string): Promise<LiveTelemetry> {
    const query = `
      query SmartMeterTelemetry($deviceId: String!) {
        smartMeterTelemetry(deviceId: $deviceId) {
          readAt
          consumption
          export
          demand
        }
      }
    `;

    let payload = await this.fetchGraphQL<TelemetryResponse>(query, { deviceId: deviceId.trim() });
    if (payload.errors?.length && this.isAuthenticationError(payload.errors)) {
      this.token = undefined;
      payload = await this.fetchGraphQL<TelemetryResponse>(query, { deviceId: deviceId.trim() });
    }

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message ?? 'GraphQL error').join('; '));
    }

    const reading = payload.data?.smartMeterTelemetry?.[0];
    if (!reading) {
      throw new Error('No live smart meter telemetry returned');
    }

    const demandWatts = this.parseNumber(reading.demand, 'demand');
    return {
      readAt: reading.readAt,
      demandWatts,
      importedWh: this.parseOptionalNumber(reading.consumption),
      exportedWh: this.parseOptionalNumber(reading.export),
    };
  }

  private async fetchGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
    const token = await this.getToken();
    const response = await this.fetchWithTimeout(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Octopus GraphQL HTTP ${response.status}`);
    }
    return response.json() as Promise<GraphQLResponse<T>>;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    const request = this.obtainToken();
    this.tokenPromise = request;
    try {
      return await request;
    } finally {
      if (this.tokenPromise === request) {
        this.tokenPromise = undefined;
      }
    }
  }

  private async obtainToken(): Promise<string> {
    const response = await this.fetchWithTimeout(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          mutation ObtainKrakenToken($input: ObtainJSONWebTokenInput!) {
            obtainKrakenToken(input: $input) { token }
          }
        `,
        variables: { input: { APIKey: this.apiKey } },
      }),
    });
    if (!response.ok) {
      throw new Error(`Octopus authentication HTTP ${response.status}`);
    }

    const payload = await response.json() as GraphQLResponse<TokenResponse>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message ?? 'Authentication error').join('; '));
    }

    const token = payload.data?.obtainKrakenToken?.token;
    if (!token) {
      throw new Error('Octopus authentication did not return a token');
    }

    this.token = token;
    this.tokenExpiresAt = this.readJwtExpiry(token) ?? Date.now() + 55 * 60_000;
    return token;
  }

  private async fetchRest(url: string): Promise<ConsumptionResponse> {
    this.log.debug('Requesting Octopus half-hourly consumption data.');
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Octopus REST HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<ConsumptionResponse>;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCTOPUS_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Octopus API request timed out after ${OCTOPUS_REQUEST_TIMEOUT_MS / 1000} seconds`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseNumber(value: string | number | undefined, field: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Live telemetry ${field} is missing or invalid`);
    }
    return parsed;
  }

  private parseOptionalNumber(value: string | number | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private isAuthenticationError(errors: Array<{ message?: string }>): boolean {
    return errors.some((error) => /auth|token|expired|permission/i.test(error.message ?? ''));
  }

  private readJwtExpiry(token: string): number | undefined {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: number };
      return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
    } catch {
      return undefined;
    }
  }
}
