import { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { OctopusEnergyLivePlatform } from './platform';
import { OctopusApiClient } from './octopusApi';
import { buildMatterCumulativeEnergyMeasurement, livePowerForSide, wattsToMatterMilliwatts } from './energy';

export type MeterSide = 'import' | 'export';

export interface MeterConfig {
  name: string;
  mpan: string;
  meterSerial: string;
  side: MeterSide;
}

interface MeterReading {
  watts: number;
  totalKWh: number;
  readAt?: Date;
  isLifetimeTotal: boolean;
}

export class OctopusMeterAccessory {
  private evePower: ReturnType<Service['getCharacteristic']> | null = null;
  private eveTotal: ReturnType<Service['getCharacteristic']> | null = null;
  private lastWatts = 0;
  private lastTotalKWh = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly platform: OctopusEnergyLivePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly meter: MeterConfig,
    private readonly client: OctopusApiClient,
    private readonly pollSeconds: number,
    private readonly homeMiniDeviceId?: string,
    private readonly matterUuid?: string,
  ) {
    const { Service, Characteristic } = this.platform;

    const info = this.accessory.getService(Service.AccessoryInformation);
    info?.setCharacteristic(Characteristic.Manufacturer, 'Octopus Energy');
    info?.setCharacteristic(Characteristic.Model, `${meter.side.toUpperCase()} meter`);
    info?.setCharacteristic(Characteristic.SerialNumber, meter.meterSerial);

    const outlet = this.accessory.getService(Service.Outlet)
      || this.accessory.addService(Service.Outlet);
    outlet.setCharacteristic(Characteristic.Name, meter.name);
    outlet.updateCharacteristic(Characteristic.On, true);
    outlet.updateCharacteristic(Characteristic.OutletInUse, true);
    outlet.getCharacteristic(Characteristic.On).onSet(async () => {
      // This accessory is read-only; keep it "on" for classic HomeKit presence.
      outlet.updateCharacteristic(Characteristic.On, true);
    });
    this.removeLegacyOutletCharacteristic(outlet, this.platform.Eve.Power);
    this.removeLegacyOutletCharacteristic(outlet, this.platform.Eve.TotalConsumption);
    const meterService = this.accessory.services.find(
      (service) => service.UUID === this.platform.Eve.EnergyMeterServiceUUID,
    )
      || this.accessory.addService(this.platform.Eve.createEnergyMeterService(`${meter.name} Energy`));
    this.evePower = meterService.getCharacteristic(this.platform.Eve.Power);
    this.eveTotal = meterService.getCharacteristic(this.platform.Eve.TotalConsumption);

    this.lastWatts = typeof this.accessory.context.lastWatts === 'number' ? this.accessory.context.lastWatts : 0;
    this.lastTotalKWh = typeof this.accessory.context.totalKWh === 'number' ? this.accessory.context.totalKWh : 0;
    this.updateCachedCharacteristics();
  }

  public startPolling(): void {
    if (this.timer) {
      return;
    }

    void this.refreshNow();
    this.timer = setInterval(() => void this.refreshNow(), this.pollSeconds * 1000);
  }

  public stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private removeLegacyOutletCharacteristic(
    outlet: Service,
    charType: WithUUID<new () => Characteristic>,
  ): void {
    if (outlet.testCharacteristic(charType.UUID)) {
      const characteristic = outlet.getCharacteristic(charType.UUID);
      if (characteristic) {
        outlet.removeCharacteristic(characteristic);
      }
    }
  }

  private async refreshNow(): Promise<void> {
    try {
      const reading = await this.fetchReading();
      this.lastWatts = reading.watts;
      this.lastTotalKWh = reading.totalKWh;
      this.accessory.context.lastWatts = reading.watts;
      this.accessory.context.totalKWh = reading.totalKWh;
      this.updateCachedCharacteristics();
      await this.updateMatter(reading);

      const source = this.homeMiniDeviceId ? 'Home Mini live telemetry' : 'half-hourly REST data';
      this.platform.log.debug(
        `${this.meter.name} updated from ${source}: ${reading.watts.toFixed(2)} W, ${reading.totalKWh.toFixed(3)} kWh`,
      );
    } catch (error) {
      this.platform.log.warn(`Refresh failed for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async fetchReading(): Promise<MeterReading> {
    if (this.homeMiniDeviceId) {
      try {
        const telemetry = await this.client.fetchLiveTelemetry(this.homeMiniDeviceId);
        const watts = livePowerForSide(this.meter.side, telemetry.demandWatts);
        const totalWh = this.meter.side === 'import' ? telemetry.importedWh : telemetry.exportedWh;

        if (totalWh !== undefined) {
          return {
            watts,
            totalKWh: Math.max(0, totalWh / 1000),
            readAt: telemetry.readAt ? new Date(telemetry.readAt) : undefined,
            isLifetimeTotal: true,
          };
        }

        // Some meters expose live demand but not the matching cumulative
        // register. Keep the live watts and obtain energy from REST.
        const interval = await this.client.fetchIntervalReading(this.meter.mpan, this.meter.meterSerial);
        return {
          watts,
          totalKWh: interval.totalKWh,
          readAt: telemetry.readAt ? new Date(telemetry.readAt) : interval.periodEnd,
          isLifetimeTotal: false,
        };
      } catch (error) {
        this.platform.log.warn(
          `Live telemetry failed for ${this.meter.name}; using interval data: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const interval = await this.client.fetchIntervalReading(this.meter.mpan, this.meter.meterSerial);
    return {
      watts: interval.watts,
      totalKWh: interval.totalKWh,
      readAt: interval.periodEnd,
      isLifetimeTotal: false,
    };
  }

  private updateCachedCharacteristics(): void {
    this.evePower?.updateValue(Math.max(0, this.lastWatts) as CharacteristicValue);
    this.eveTotal?.updateValue(Math.max(0, this.lastTotalKWh) as CharacteristicValue);
  }

  private async updateMatter(reading: MeterReading): Promise<void> {
    const matter = this.platform.api.matter;
    if (!matter || !this.matterUuid) {
      return;
    }

    await matter.updateAccessoryState(
      this.matterUuid,
      matter.clusterNames.ElectricalPowerMeasurement,
      { activePower: wattsToMatterMilliwatts(reading.watts) },
    );

    const energy = buildMatterCumulativeEnergyMeasurement(
      reading.totalKWh,
      reading.readAt,
      reading.isLifetimeTotal,
    );
    const attribute = this.meter.side === 'import' ? 'cumulativeEnergyImported' : 'cumulativeEnergyExported';
    await matter.updateAccessoryState(
      this.matterUuid,
      matter.clusterNames.ElectricalEnergyMeasurement,
      { [attribute]: energy },
    );
  }
}
