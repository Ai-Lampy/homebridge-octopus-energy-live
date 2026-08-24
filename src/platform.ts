import {
  API,
  APIEvent,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  MatterAccessory,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { OctopusMeterAccessory, MeterConfig, MeterSide } from './accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { EveCharacteristics, getEveCharacteristics } from './eve';
import { OctopusApiClient } from './octopusApi';
import {
  buildMatterCumulativeEnergyMeasurement,
  buildMatterDailyEnergyMeasurement,
  kWhToMatterMilliwattHours,
  wattsToMatterMilliwatts,
} from './energy';
import { GasMeterConfig, OctopusGasMeterAccessory } from './gasAccessory';
import { GasConsumptionUnit, gasConsumptionToKWh } from './gas';

interface MeterEntry {
  name?: string;
  mpan: string;
  meterSerial: string;
}

interface GasMeterEntry {
  name?: string;
  mprn: string;
  meterSerial: string;
  unit?: 'auto' | 'kWh' | 'm3';
  exposeToMatter?: boolean;
  exposeDailyUsageToMatter?: boolean;
  exposeDailyUsageAccessory?: boolean;
  pollMinutes?: number;
  useLiveTelemetry?: boolean;
  homeMiniDeviceId?: string;
}

interface PollingAccessory {
  startPolling(): void;
  stopPolling(): void;
}

interface OctopusPlatformConfig extends PlatformConfig {
  apiKey: string;
  accountNumber?: string;
  pollSeconds?: number;
  homeMiniDeviceId?: string;
  import: MeterEntry;
  gas?: GasMeterEntry;
  export?: MeterEntry;
}

export class OctopusEnergyLivePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly Eve: EveCharacteristics;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly matterAccessories: MatterAccessory[] = [];
  private readonly pendingMatterRegistrations: MatterAccessory[] = [];
  private readonly pendingMatterUnregistrations: MatterAccessory[] = [];
  private readonly managed: PollingAccessory[] = [];
  private pollSeconds: number;
  private readonly client: OctopusApiClient;
  private homeMiniDeviceId?: string;
  private pollingStartTimer?: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    public readonly config: OctopusPlatformConfig,
    public readonly api: API,
  ) {
    this.Eve = getEveCharacteristics(this.api);
    const hasLiveTelemetry = Boolean(config?.homeMiniDeviceId?.trim() || config?.accountNumber?.trim());
    const defaultPollSeconds = hasLiveTelemetry ? 30 : 300;
    const minimumPollSeconds = hasLiveTelemetry ? 30 : 60;
    this.pollSeconds = Math.max(
      minimumPollSeconds,
      typeof config?.pollSeconds === 'number' ? config.pollSeconds : defaultPollSeconds,
    );
    this.client = new OctopusApiClient(config?.apiKey ?? '', this.log);
    this.homeMiniDeviceId = config?.homeMiniDeviceId?.trim() || undefined;

    if (
      !config?.apiKey?.trim()
      || !config.import?.mpan?.trim()
      || !config.import.meterSerial?.trim()
    ) {
      this.log.error('Configuration requires an API key, electricity MPAN, and electricity meter serial; plugin will not start.');
      return;
    }

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      this.log.debug('Finished launching, starting discovery');
      try {
        await this.discoverMeters();
        this.pollingStartTimer = setTimeout(() => {
          this.pollingStartTimer = undefined;
          this.log.info(`Starting polling for ${this.managed.length} meter ${
            this.managed.length === 1 ? 'accessory' : 'accessories'
          }.`);
          this.managed.forEach((meter) => meter.startPolling());
        }, 15000);
      } catch (error) {
        this.log.error(`Meter discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    this.api.on(APIEvent.SHUTDOWN, () => {
      if (this.pollingStartTimer) {
        clearTimeout(this.pollingStartTimer);
        this.pollingStartTimer = undefined;
      }
      this.managed.forEach((meter) => meter.stopPolling());
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restored accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  configureMatterAccessory(accessory: MatterAccessory): void {
    this.log.info('Restored Matter accessory from cache:', accessory.displayName);
    this.matterAccessories.push(accessory);
  }

  private async discoverMeters(): Promise<void> {
    if (!this.config || !this.config.apiKey) {
      return;
    }

    if (!this.config.import) {
      this.log.error('Electricity meter configuration missing.');
      return;
    }

    if (!this.homeMiniDeviceId && this.config.accountNumber?.trim()) {
      try {
        this.homeMiniDeviceId = await this.client.discoverElectricityDeviceId(
          this.config.accountNumber,
          this.config.import.mpan,
          this.config.import.meterSerial,
        );
        this.log.info('Discovered a Home Mini electricity meter for live telemetry.');
      } catch (error) {
        this.log.warn(
          `Could not discover a Home Mini electricity meter; using half-hourly data: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (this.config.pollSeconds === undefined) {
          this.pollSeconds = 300;
        }
      }
    }

    if (this.config.gas?.useLiveTelemetry === true && this.pollSeconds < 60) {
      this.pollSeconds = 60;
      this.log.info('Using a 60-second electricity polling interval to stay within the Octopus telemetry rate limit.');
    }

    const activeElectricityUuids = new Set<string>();
    await this.registerMeter('import', this.config.import);
    activeElectricityUuids.add(this.electricityAccessoryUuid('import', this.config.import));

    let gasUuid: string | undefined;
    if (this.config.gas?.mprn?.trim() || this.config.gas?.meterSerial?.trim()) {
      if (this.config.gas.mprn?.trim() && this.config.gas.meterSerial?.trim()) {
        gasUuid = this.api.hap.uuid.generate(`gas-${this.config.gas.mprn}-${this.config.gas.meterSerial}`);
        await this.registerGasMeter(this.config.gas, gasUuid);
      } else {
        this.log.warn('Gas configuration incomplete; skipping gas accessory. Both MPRN and meter serial are required.');
      }
    }
    await this.removeStaleGasAccessories(gasUuid);

    if (this.config.export) {
      if (this.config.export.mpan && this.config.export.meterSerial) {
        await this.registerMeter('export', this.config.export);
        activeElectricityUuids.add(this.electricityAccessoryUuid('export', this.config.export));
      } else {
        this.log.warn('Export configuration incomplete; skipping export accessory.');
      }
    }
    await this.removeStaleElectricityAccessories(activeElectricityUuids);

    try {
      await this.flushMatterAccessoryChanges();
    } catch (error) {
      this.log.warn(
        `Matter accessory registration failed; HAP accessories and polling will continue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async registerGasMeter(meter: GasMeterEntry, uuid: string): Promise<void> {
    let unit: GasConsumptionUnit;
    let gasDeviceId = meter.homeMiniDeviceId?.trim() || undefined;
    let discoveredDetails: Awaited<ReturnType<OctopusApiClient['discoverGasMeterDetails']>> | undefined;
    if (this.config.accountNumber?.trim() && (meter.unit === undefined || meter.unit === 'auto' || (meter.useLiveTelemetry && !gasDeviceId))) {
      try {
        discoveredDetails = await this.client.discoverGasMeterDetails(
          this.config.accountNumber,
          meter.mprn,
          meter.meterSerial,
        );
        gasDeviceId ||= discoveredDetails.deviceId;
      } catch (error) {
        this.log.warn(`Could not discover gas meter details: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (meter.unit === 'kWh') {
      unit = 'kWh';
    } else if (meter.unit === 'm3') {
      unit = 'm³';
    } else {
      if (!this.config.accountNumber?.trim()) {
        unit = 'm³';
        this.log.warn(
          'Gas unit auto-detection requires an account number; assuming m³ for a SMETS2 meter. '
          + 'Choose kWh manually in plugin settings for a SMETS1 meter.',
        );
      } else {
        try {
          unit = discoveredDetails?.unit ?? await this.client.discoverGasConsumptionUnit(
            this.config.accountNumber, meter.mprn, meter.meterSerial,
          );
          this.log.info(`Detected gas consumption unit: ${unit}.`);
        } catch (error) {
          unit = 'm³';
          this.log.warn(
            `Could not determine the gas consumption unit; assuming m³ for a SMETS2 meter. ${
              'Choose kWh manually in plugin settings for a SMETS1 meter: '
            }${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    const useLiveTelemetry = meter.useLiveTelemetry === true && Boolean(gasDeviceId);
    if (meter.useLiveTelemetry && !gasDeviceId) {
      this.log.warn('Home Mini gas telemetry was enabled but no GSME device ID was found; using half-hourly REST data.');
    } else if (useLiveTelemetry) {
      this.log.info('Discovered a Home Mini gas meter for experimental telemetry.');
    }

    const name = meter.name || 'Gas Meter';
    const existing = this.accessories.find((accessory) => accessory.UUID === uuid);
    const accessory = existing ?? new this.api.platformAccessory(name, uuid);

    accessory.displayName = name;
    if (existing) {
      this.log.info('Updating cached gas accessory', name);
    } else {
      this.log.info('Registering new gas accessory', name);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }

    accessory.context.gas = {
      name,
      mprn: meter.mprn,
      meterSerial: meter.meterSerial,
      unit,
      pollMinutes: meter.pollMinutes,
      exposeDailyUsageToMatter: meter.exposeDailyUsageToMatter === true,
      exposeDailyUsageAccessory: meter.exposeDailyUsageAccessory === true,
      useLiveTelemetry,
      homeMiniDeviceId: gasDeviceId,
    } as GasMeterConfig;
    const matterUuid = meter.exposeToMatter === true
      ? await this.registerMatterGasMeter(accessory.context.gas, accessory)
      : undefined;
    const dailyMatterUuid = meter.exposeDailyUsageAccessory === true
      ? await this.registerMatterDailyGasUsage(accessory.context.gas, accessory)
      : undefined;
    this.managed.push(new OctopusGasMeterAccessory(
      this,
      accessory,
      accessory.context.gas,
      this.client,
      matterUuid,
      dailyMatterUuid,
    ));
    this.api.updatePlatformAccessories([accessory]);
  }

  private async removeStaleGasAccessories(activeUuid?: string): Promise<void> {
    const stale = this.accessories.filter((accessory) => accessory.context.gas && accessory.UUID !== activeUuid);
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const accessory of stale) {
        const index = this.accessories.indexOf(accessory);
        if (index >= 0) {
          this.accessories.splice(index, 1);
        }
        this.log.info('Removed stale gas accessory', accessory.displayName);
      }
    }

    const activeMatterUuids = new Set<string>();
    if (this.config.gas?.mprn?.trim() && this.config.gas.meterSerial?.trim()) {
      if (this.config.gas.exposeToMatter === true) {
        activeMatterUuids.add(this.gasMatterUuid(
          this.config.gas.mprn,
          this.config.gas.meterSerial,
          this.config.gas.exposeDailyUsageToMatter === true,
          this.config.gas.useLiveTelemetry === true,
        ));
      }
      if (this.config.gas.exposeDailyUsageAccessory === true) {
        activeMatterUuids.add(this.dailyGasMatterUuid(
          this.config.gas.mprn,
          this.config.gas.meterSerial,
        ));
      }
    }
    const staleMatter = this.matterAccessories.filter(
      (accessory) => accessory.context.fuel === 'gas'
        && !activeMatterUuids.has(accessory.UUID),
    );
    if (staleMatter.length && this.api.matter) {
      for (const accessory of staleMatter) {
        this.queueMatterUnregistration(accessory);
        const index = this.matterAccessories.indexOf(accessory);
        if (index >= 0) {
          this.matterAccessories.splice(index, 1);
        }
        this.log.info('Removed stale Matter gas outlet', accessory.displayName);
      }
    }
  }

  private async registerMatterGasMeter(
    meter: GasMeterConfig,
    hapAccessory: PlatformAccessory,
  ): Promise<string | undefined> {
    const matter = this.api.matter;
    if (!matter || typeof this.api.isMatterEnabled !== 'function' || !this.api.isMatterEnabled()) {
      return undefined;
    }

    const uuid = this.gasMatterUuid(
      meter.mprn,
      meter.meterSerial,
      meter.exposeDailyUsageToMatter,
      meter.useLiveTelemetry,
    );
    const existing = this.matterAccessories.find((accessory) => accessory.UUID === uuid);
    const totalKWh = typeof hapAccessory.context.matterGasCumulativeKWh === 'number'
      ? hapAccessory.context.matterGasCumulativeKWh
      : hapAccessory.context.lastGasValuesAreKWh === true
        ? (typeof hapAccessory.context.lastGasCumulativeKWh === 'number'
          ? hapAccessory.context.lastGasCumulativeKWh
          : 0)
      : gasConsumptionToKWh(
        typeof hapAccessory.context.lastGasTotalConsumption === 'number'
          ? hapAccessory.context.lastGasTotalConsumption
          : 0,
        meter.unit,
      );
    const matterAccessory: MatterAccessory = existing ?? {
      UUID: uuid,
      displayName: meter.name,
      deviceType: matter.deviceTypes.OnOffOutlet,
      manufacturer: 'Octopus Energy',
      model: 'Gas energy meter',
      serialNumber: meter.meterSerial,
      context: {},
    };

    matterAccessory.displayName = meter.name;
    matterAccessory.deviceType = matter.deviceTypes.OnOffOutlet;
    matterAccessory.manufacturer = 'Octopus Energy';
    matterAccessory.model = 'Gas energy meter';
    matterAccessory.serialNumber = meter.meterSerial;
    matterAccessory.context = {
      fuel: 'gas',
      mprn: meter.mprn,
      meterSerial: meter.meterSerial,
      exposesDailyUsage: meter.exposeDailyUsageToMatter === true,
    };
    const electricalEnergyMeasurement: Record<string, unknown> = {
      cumulativeEnergyImported: { energy: kWhToMatterMilliwattHours(totalKWh) },
    };
    const lastTodayKWh = hapAccessory.context.lastGasValuesAreKWh === true
      ? (typeof hapAccessory.context.lastGasTotalConsumption === 'number'
        ? hapAccessory.context.lastGasTotalConsumption
        : 0)
      : gasConsumptionToKWh(
        typeof hapAccessory.context.lastGasTotalConsumption === 'number'
          ? hapAccessory.context.lastGasTotalConsumption
          : 0,
        meter.unit,
      );
    if (meter.exposeDailyUsageToMatter) {
      electricalEnergyMeasurement.periodicEnergyImported = buildMatterDailyEnergyMeasurement(
        lastTodayKWh,
      );
    }
    matterAccessory.clusters = {
      onOff: { onOff: true },
      ...(meter.useLiveTelemetry
        ? { electricalPowerMeasurement: { activePower: null } }
        : {}),
      electricalEnergyMeasurement,
    };
    matterAccessory.handlers = {
      onOff: {
        on: async () => {
          await matter.updateAccessoryState(uuid, matter.clusterNames.OnOff, { onOff: true });
        },
        off: async () => {
          await matter.updateAccessoryState(uuid, matter.clusterNames.OnOff, { onOff: true });
        },
      },
    };

    this.logMatterProfile(
      meter.name,
      meter.useLiveTelemetry === true,
      'imported',
      meter.exposeDailyUsageToMatter === true,
    );
    this.queueMatterRegistration(matterAccessory);
    if (existing) {
      this.log.info('Restoring cached Matter gas outlet', meter.name);
    } else {
      this.matterAccessories.push(matterAccessory);
      this.log.info('Preparing new Matter gas outlet', meter.name);
    }
    return uuid;
  }

  private gasMatterUuid(
    mprn: string,
    meterSerial: string,
    includesDailyUsage = false,
    includesLivePower = false,
  ): string {
    const profile = includesDailyUsage ? 'daily-' : '';
    const telemetryProfile = includesLivePower ? 'telemetry-' : '';
    return this.api.hap.uuid.generate(`matter-outlet-gas-${profile}${telemetryProfile}${mprn}-${meterSerial}`);
  }

  private async registerMatterDailyGasUsage(
    meter: GasMeterConfig,
    hapAccessory: PlatformAccessory,
  ): Promise<string | undefined> {
    const matter = this.api.matter;
    if (!matter || typeof this.api.isMatterEnabled !== 'function' || !this.api.isMatterEnabled()) {
      return undefined;
    }

    const uuid = this.dailyGasMatterUuid(meter.mprn, meter.meterSerial);
    const existing = this.matterAccessories.find((accessory) => accessory.UUID === uuid);
    const todayKWh = hapAccessory.context.lastGasValuesAreKWh === true
      ? (typeof hapAccessory.context.lastGasTotalConsumption === 'number'
        ? hapAccessory.context.lastGasTotalConsumption
        : 0)
      : gasConsumptionToKWh(
        typeof hapAccessory.context.lastGasTotalConsumption === 'number'
          ? hapAccessory.context.lastGasTotalConsumption
          : 0,
        meter.unit,
      );
    const lifetimeKWh = typeof hapAccessory.context.matterGasCumulativeKWh === 'number'
      ? hapAccessory.context.matterGasCumulativeKWh
      : 0;
    const displayName = 'Gas Used Today';
    const matterAccessory: MatterAccessory = existing ?? {
      UUID: uuid,
      displayName,
      deviceType: matter.deviceTypes.OnOffOutlet,
      manufacturer: 'Octopus Energy',
      model: 'Daily gas energy meter',
      serialNumber: `${meter.meterSerial}-daily`,
      context: {},
    };

    matterAccessory.displayName = displayName;
    matterAccessory.deviceType = matter.deviceTypes.OnOffOutlet;
    matterAccessory.manufacturer = 'Octopus Energy';
    matterAccessory.model = 'Daily gas energy meter';
    matterAccessory.serialNumber = `${meter.meterSerial}-daily`;
    matterAccessory.context = {
      fuel: 'gas',
      profile: 'daily-usage',
      powerDisplayProxy: true,
      mprn: meter.mprn,
      meterSerial: meter.meterSerial,
    };
    matterAccessory.clusters = {
      onOff: { onOff: true },
      // Apple Home prominently renders active power but currently hides
      // periodic energy on an outlet tile. This opt-in endpoint deliberately
      // maps the daily kWh number to kW so the displayed numeric value matches
      // Octopus (for example, 1.62 kWh appears as 1.62 kW).
      electricalPowerMeasurement: { activePower: wattsToMatterMilliwatts(todayKWh * 1000) },
      electricalEnergyMeasurement: {
        cumulativeEnergyImported: buildMatterCumulativeEnergyMeasurement(lifetimeKWh, undefined, false),
        periodicEnergyImported: buildMatterDailyEnergyMeasurement(todayKWh),
      },
    };
    matterAccessory.handlers = {
      onOff: {
        on: async () => {
          await matter.updateAccessoryState(uuid, matter.clusterNames.OnOff, { onOff: true });
        },
        off: async () => {
          await matter.updateAccessoryState(uuid, matter.clusterNames.OnOff, { onOff: true });
        },
      },
    };

    this.logMatterProfile(displayName, true, 'imported', true);
    this.queueMatterRegistration(matterAccessory);
    if (existing) {
      this.log.info('Restoring cached Matter daily gas accessory', displayName);
    } else {
      this.matterAccessories.push(matterAccessory);
      this.log.info('Preparing new Matter daily gas accessory', displayName);
    }
    return uuid;
  }

  private dailyGasMatterUuid(mprn: string, meterSerial: string): string {
    return this.api.hap.uuid.generate(`matter-gas-daily-usage-${mprn}-${meterSerial}`);
  }

  private async registerMeter(side: MeterSide, meter: MeterEntry): Promise<void> {
    const name = meter.name || (side === 'import' ? 'Electricity Meter' : 'Octopus Export');
    const uuid = this.electricityAccessoryUuid(side, meter);

    const existing = this.accessories.find((accessory) => accessory.UUID === uuid);

    let accessory: PlatformAccessory;
    if (existing) {
      accessory = existing;
      accessory.displayName = name;
      this.log.info('Updating cached accessory', name);
    } else {
      accessory = new this.api.platformAccessory(name, uuid);
      this.log.info('Registering new accessory', name);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }

    accessory.context.meter = {
      side,
      mpan: meter.mpan,
      meterSerial: meter.meterSerial,
      name,
    } as MeterConfig;

    const matterUuid = await this.registerMatterMeter(side, accessory.context.meter, accessory);
    const octopusAccessory = new OctopusMeterAccessory(
      this,
      accessory,
      accessory.context.meter,
      this.client,
      this.pollSeconds,
      this.homeMiniDeviceId,
      matterUuid,
    );

    this.managed.push(octopusAccessory);
    this.api.updatePlatformAccessories([accessory]);
  }

  private async registerMatterMeter(
    side: MeterSide,
    meter: MeterConfig,
    hapAccessory: PlatformAccessory,
  ): Promise<string | undefined> {
    const matter = this.api.matter;
    if (!matter || typeof this.api.isMatterEnabled !== 'function' || !this.api.isMatterEnabled()) {
      return undefined;
    }

    const uuid = this.electricityMatterUuid(side, meter);
    const existing = this.matterAccessories.find((accessory) => accessory.UUID === uuid);
    const lastWatts = typeof hapAccessory.context.lastWatts === 'number' ? hapAccessory.context.lastWatts : 0;
    const totalKWh = typeof hapAccessory.context.totalKWh === 'number' ? hapAccessory.context.totalKWh : 0;
    const energyAttribute = side === 'import' ? 'cumulativeEnergyImported' : 'cumulativeEnergyExported';
    const matterAccessory: MatterAccessory = existing ?? {
      UUID: uuid,
      displayName: meter.name,
      deviceType: matter.deviceTypes.OnOffOutlet,
      manufacturer: 'Octopus Energy',
      model: `${side.toUpperCase()} smart meter`,
      serialNumber: meter.meterSerial,
      context: {},
    };

    matterAccessory.displayName = meter.name;
    matterAccessory.deviceType = matter.deviceTypes.OnOffOutlet;
    matterAccessory.manufacturer = 'Octopus Energy';
    matterAccessory.model = `${side.toUpperCase()} smart meter`;
    matterAccessory.serialNumber = meter.meterSerial;
    matterAccessory.context = { side, mpan: meter.mpan, meterSerial: meter.meterSerial };
    matterAccessory.clusters = {
      onOff: { onOff: true },
      electricalPowerMeasurement: { activePower: wattsToMatterMilliwatts(lastWatts) },
      electricalEnergyMeasurement: {
        [energyAttribute]: { energy: kWhToMatterMilliwattHours(totalKWh) },
      },
    };
    matterAccessory.handlers = {
      onOff: {
        on: async () => {
          await matter.updateAccessoryState(uuid, matter.clusterNames.OnOff, { onOff: true });
        },
        off: async () => {
          await matter.updateAccessoryState(uuid, matter.clusterNames.OnOff, { onOff: true });
        },
      },
    };

    this.logMatterProfile(meter.name, true, side === 'import' ? 'imported' : 'exported');
    this.queueMatterRegistration(matterAccessory);
    if (existing) {
      this.log.info('Restoring cached Matter energy outlet', meter.name);
    } else {
      this.matterAccessories.push(matterAccessory);
      this.log.info('Preparing new Matter energy outlet', meter.name);
    }

    const legacyUuid = this.api.hap.uuid.generate(`matter-${side}-${meter.mpan}-${meter.meterSerial}`);
    const legacy = this.matterAccessories.filter((accessory) => accessory.UUID === legacyUuid);
    if (legacy.length) {
      for (const accessory of legacy) {
        this.queueMatterUnregistration(accessory);
        const index = this.matterAccessories.indexOf(accessory);
        if (index >= 0) {
          this.matterAccessories.splice(index, 1);
        }
      }
      this.log.info('Removed legacy Matter energy sensor', meter.name);
    }
    return uuid;
  }

  private electricityAccessoryUuid(side: MeterSide, meter: MeterEntry): string {
    return this.api.hap.uuid.generate(`${side}-${meter.mpan}-${meter.meterSerial}`);
  }

  private electricityMatterUuid(side: MeterSide, meter: MeterEntry): string {
    return this.api.hap.uuid.generate(`matter-outlet-${side}-${meter.mpan}-${meter.meterSerial}`);
  }

  private async removeStaleElectricityAccessories(activeHapUuids: Set<string>): Promise<void> {
    const staleHap = this.accessories.filter(
      (accessory) => accessory.context.meter && !activeHapUuids.has(accessory.UUID),
    );
    if (staleHap.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleHap);
      for (const accessory of staleHap) {
        const index = this.accessories.indexOf(accessory);
        if (index >= 0) {
          this.accessories.splice(index, 1);
        }
        this.log.info('Removed stale electricity accessory', accessory.displayName);
      }
    }

    if (!this.api.matter) {
      return;
    }
    const activeMatterUuids = new Set<string>();
    activeMatterUuids.add(this.electricityMatterUuid('import', this.config.import));
    if (this.config.export?.mpan?.trim() && this.config.export.meterSerial?.trim()) {
      activeMatterUuids.add(this.electricityMatterUuid('export', this.config.export));
    }
    const staleMatter = this.matterAccessories.filter(
      (accessory) => (accessory.context.side === 'import' || accessory.context.side === 'export')
        && !activeMatterUuids.has(accessory.UUID),
    );
    for (const accessory of staleMatter) {
      this.queueMatterUnregistration(accessory);
      const index = this.matterAccessories.indexOf(accessory);
      if (index >= 0) {
        this.matterAccessories.splice(index, 1);
      }
      this.log.info('Removed stale Matter electricity outlet', accessory.displayName);
    }
  }

  private logMatterProfile(
    displayName: string,
    includesLivePower: boolean,
    energyDirection: 'imported' | 'exported',
    includesPeriodicEnergy = false,
  ): void {
    const measurementClusters = includesLivePower
      ? 'ElectricalPowerMeasurement (0x0090), ElectricalEnergyMeasurement (0x0091)'
      : 'ElectricalEnergyMeasurement (0x0091)';

    this.log.info(
      `Matter profile for ${displayName}: bridged On/Off Plug-in Unit (0x010A) + Electrical Sensor (0x0510); `
      + `OnOff (0x0006), ${measurementClusters}; cumulative energy ${energyDirection}`
      + `${includesPeriodicEnergy ? ' plus periodic energy for today' : ''}.`,
    );
    this.log.debug(
      `Homebridge assigns ${displayName}'s endpoint number and adds PowerTopology (0x009C, TreeTopology) `
      + 'when it registers the electrical measurement clusters. Endpoint 0 remains the Matter root node.',
    );
  }

  private queueMatterRegistration(accessory: MatterAccessory): void {
    if (!this.pendingMatterRegistrations.some((candidate) => candidate.UUID === accessory.UUID)) {
      this.pendingMatterRegistrations.push(accessory);
    }
  }

  private queueMatterUnregistration(accessory: MatterAccessory): void {
    if (!this.pendingMatterUnregistrations.some((candidate) => candidate.UUID === accessory.UUID)) {
      this.pendingMatterUnregistrations.push(accessory);
    }
  }

  private async flushMatterAccessoryChanges(): Promise<void> {
    const matter = this.api.matter;
    if (!matter || typeof this.api.isMatterEnabled !== 'function' || !this.api.isMatterEnabled()) {
      this.pendingMatterUnregistrations.length = 0;
      this.pendingMatterRegistrations.length = 0;
      return;
    }

    try {
      if (this.pendingMatterUnregistrations.length) {
        const accessories = [...this.pendingMatterUnregistrations];
        await matter.unregisterPlatformAccessories(
          PLUGIN_NAME,
          PLATFORM_NAME,
          accessories,
        );
        // Homebridge's bridged Matter API dispatches structural operations
        // asynchronously. Give cache-only removals time to finish before the
        // single registration batch is dispatched.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      if (this.pendingMatterRegistrations.length) {
        const accessories = [...this.pendingMatterRegistrations];
        await matter.registerPlatformAccessories(
          PLUGIN_NAME,
          PLATFORM_NAME,
          accessories,
        );
        this.log.info(`Submitted ${accessories.length} Matter accessory endpoint(s) for registration.`);
      }
    } finally {
      this.pendingMatterUnregistrations.length = 0;
      this.pendingMatterRegistrations.length = 0;
    }
  }
}
