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
import { kWhToMatterMilliwattHours, wattsToMatterMilliwatts } from './energy';
import { GasMeterConfig, OctopusGasMeterAccessory } from './gasAccessory';
import { GasConsumptionUnit } from './gas';

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
  private readonly managed: PollingAccessory[] = [];
  private pollSeconds: number;
  private readonly client: OctopusApiClient;
  private homeMiniDeviceId?: string;

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
        setTimeout(() => {
          this.managed.forEach((meter) => meter.startPolling());
        }, 15000);
      } catch (error) {
        this.log.error(`Meter discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    this.api.on(APIEvent.SHUTDOWN, () => {
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

    await this.registerMeter('import', this.config.import);

    let gasUuid: string | undefined;
    if (this.config.gas?.mprn?.trim() || this.config.gas?.meterSerial?.trim()) {
      if (this.config.gas.mprn?.trim() && this.config.gas.meterSerial?.trim()) {
        gasUuid = this.api.hap.uuid.generate(`gas-${this.config.gas.mprn}-${this.config.gas.meterSerial}`);
        await this.registerGasMeter(this.config.gas, gasUuid);
      } else {
        this.log.warn('Gas configuration incomplete; skipping gas accessory. Both MPRN and meter serial are required.');
      }
    }
    this.removeStaleGasAccessories(gasUuid);

    if (this.config.export) {
      if (this.config.export.mpan && this.config.export.meterSerial) {
        await this.registerMeter('export', this.config.export);
      } else {
        this.log.warn('Export configuration incomplete; skipping export accessory.');
      }
    }
  }

  private async registerGasMeter(meter: GasMeterEntry, uuid: string): Promise<void> {
    let unit: GasConsumptionUnit;
    if (meter.unit === 'kWh') {
      unit = 'kWh';
    } else if (meter.unit === 'm3') {
      unit = 'm³';
    } else {
      if (!this.config.accountNumber?.trim()) {
        this.log.error(
          'Gas unit auto-detection requires the Octopus account number. Add it or choose the gas consumption unit manually.',
        );
        return;
      }
      try {
        unit = await this.client.discoverGasConsumptionUnit(
          this.config.accountNumber,
          meter.mprn,
          meter.meterSerial,
        );
        this.log.info(`Detected gas consumption unit: ${unit}.`);
      } catch (error) {
        this.log.error(
          `Could not determine the gas consumption unit; choose it manually in plugin settings: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
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
    } as GasMeterConfig;
    this.managed.push(new OctopusGasMeterAccessory(this, accessory, accessory.context.gas, this.client));
    this.api.updatePlatformAccessories([accessory]);

    if (typeof this.api.isMatterEnabled === 'function' && this.api.isMatterEnabled()) {
      this.log.info(
        'Gas data is available through classic HomeKit custom characteristics; Matter and Apple Home do not currently define a gas-consumption cluster.',
      );
    }
  }

  private removeStaleGasAccessories(activeUuid?: string): void {
    const stale = this.accessories.filter((accessory) => accessory.context.gas && accessory.UUID !== activeUuid);
    if (!stale.length) {
      return;
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    for (const accessory of stale) {
      const index = this.accessories.indexOf(accessory);
      if (index >= 0) {
        this.accessories.splice(index, 1);
      }
      this.log.info('Removed stale gas accessory', accessory.displayName);
    }
  }

  private async registerMeter(side: MeterSide, meter: MeterEntry): Promise<void> {
    const name = meter.name || (side === 'import' ? 'Electricity Meter' : 'Octopus Export');
    const uuid = this.api.hap.uuid.generate(`${side}-${meter.mpan}-${meter.meterSerial}`);

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

    const uuid = this.api.hap.uuid.generate(`matter-${side}-${meter.mpan}-${meter.meterSerial}`);
    const existing = this.matterAccessories.find((accessory) => accessory.UUID === uuid);
    const lastWatts = typeof hapAccessory.context.lastWatts === 'number' ? hapAccessory.context.lastWatts : 0;
    const totalKWh = typeof hapAccessory.context.totalKWh === 'number' ? hapAccessory.context.totalKWh : 0;
    const energyAttribute = side === 'import' ? 'cumulativeEnergyImported' : 'cumulativeEnergyExported';
    const matterAccessory: MatterAccessory = existing ?? {
      UUID: uuid,
      displayName: meter.name,
      deviceType: matter.deviceTypes.ElectricalSensor,
      manufacturer: 'Octopus Energy',
      model: `${side.toUpperCase()} smart meter`,
      serialNumber: meter.meterSerial,
      context: {},
    };

    matterAccessory.displayName = meter.name;
    matterAccessory.deviceType = matter.deviceTypes.ElectricalSensor;
    matterAccessory.manufacturer = 'Octopus Energy';
    matterAccessory.model = `${side.toUpperCase()} smart meter`;
    matterAccessory.serialNumber = meter.meterSerial;
    matterAccessory.context = { side, mpan: meter.mpan, meterSerial: meter.meterSerial };
    matterAccessory.clusters = {
      electricalPowerMeasurement: { activePower: wattsToMatterMilliwatts(lastWatts) },
      electricalEnergyMeasurement: {
        [energyAttribute]: { energy: kWhToMatterMilliwattHours(totalKWh) },
      },
    };

    if (existing) {
      await matter.updatePlatformAccessories([matterAccessory]);
      this.log.info('Updating cached Matter energy sensor', meter.name);
    } else {
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [matterAccessory]);
      this.matterAccessories.push(matterAccessory);
      this.log.info('Registered Matter energy sensor', meter.name);
    }
    return uuid;
  }
}
