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

interface MeterEntry {
  name?: string;
  mpan: string;
  meterSerial: string;
}

interface OctopusPlatformConfig extends PlatformConfig {
  apiKey: string;
  accountNumber?: string;
  pollSeconds?: number;
  homeMiniDeviceId?: string;
  import: MeterEntry;
  export?: MeterEntry;
}

export class OctopusEnergyLivePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly Eve: EveCharacteristics;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly matterAccessories: MatterAccessory[] = [];
  private readonly managed: OctopusMeterAccessory[] = [];
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
      this.log.error('Configuration requires an API key, import MPAN, and import meter serial; plugin will not start.');
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
      this.log.error('Import meter configuration missing.');
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

    if (this.config.export) {
      if (this.config.export.mpan && this.config.export.meterSerial) {
        await this.registerMeter('export', this.config.export);
      } else {
        this.log.warn('Export configuration incomplete; skipping export accessory.');
      }
    }
  }

  private async registerMeter(side: MeterSide, meter: MeterEntry): Promise<void> {
    const name = meter.name || (side === 'import' ? 'Octopus Import' : 'Octopus Export');
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
