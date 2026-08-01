import { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { OctopusEnergyLivePlatform } from './platform';
import { OctopusApiClient } from './octopusApi';
import { buildMatterCumulativeEnergyMeasurement } from './energy';
import { GAS_POLL_INTERVAL_MS, GasConsumptionUnit, gasConsumptionToKWh } from './gas';

export interface GasMeterConfig {
  name: string;
  mprn: string;
  meterSerial: string;
  unit: GasConsumptionUnit;
}

export class OctopusGasMeterAccessory {
  private readonly outletService: Service;
  private readonly intervalConsumption: ReturnType<Service['getCharacteristic']> | null;
  private readonly totalConsumption: ReturnType<Service['getCharacteristic']> | null;
  private lastIntervalConsumption = 0;
  private lastTotalConsumption = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly platform: OctopusEnergyLivePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly meter: GasMeterConfig,
    private readonly client: OctopusApiClient,
    private readonly matterUuid?: string,
  ) {
    const { Service, Characteristic } = this.platform;
    const info = this.accessory.getService(Service.AccessoryInformation);
    info?.setCharacteristic(Characteristic.Manufacturer, 'Octopus Energy');
    info?.setCharacteristic(Characteristic.Model, 'Gas smart meter');
    info?.setCharacteristic(Characteristic.SerialNumber, meter.meterSerial);

    const outlet = this.accessory.getService(Service.Outlet) || this.accessory.addService(Service.Outlet);
    outlet.setCharacteristic(Characteristic.Name, meter.name);
    outlet.updateCharacteristic(Characteristic.On, true);
    outlet.updateCharacteristic(Characteristic.OutletInUse, true);
    outlet.getCharacteristic(Characteristic.On).onSet(async () => {
      outlet.updateCharacteristic(Characteristic.On, true);
    });
    this.outletService = outlet;

    this.intervalConsumption = this.ensureCharacteristic(this.platform.Eve.GasConsumption);
    this.totalConsumption = this.ensureCharacteristic(this.platform.Eve.TotalGasConsumption);
    this.intervalConsumption?.setProps({ unit: 'kWh' });
    this.totalConsumption?.setProps({ unit: 'kWh' });

    this.lastIntervalConsumption = typeof accessory.context.lastGasIntervalConsumption === 'number'
      ? accessory.context.lastGasIntervalConsumption
      : 0;
    this.lastTotalConsumption = typeof accessory.context.lastGasTotalConsumption === 'number'
      ? accessory.context.lastGasTotalConsumption
      : 0;
    this.updateCachedCharacteristics();
  }

  public startPolling(): void {
    if (this.timer) {
      return;
    }
    void this.refreshNow();
    this.timer = setInterval(() => void this.refreshNow(), GAS_POLL_INTERVAL_MS);
  }

  public stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private ensureCharacteristic(charType: WithUUID<new () => Characteristic>) {
    try {
      return this.outletService.getCharacteristic(charType);
    } catch {
      try {
        return this.outletService.addCharacteristic(charType);
      } catch (error) {
        this.platform.log.warn(`Failed to register gas characteristic on ${this.meter.name}: ${
          error instanceof Error ? error.message : String(error)
        }`);
        return null;
      }
    }
  }

  private async refreshNow(): Promise<void> {
    try {
      const reading = await this.client.fetchGasIntervalReading(this.meter.mprn, this.meter.meterSerial);
      this.lastIntervalConsumption = reading.intervalConsumption;
      this.lastTotalConsumption = reading.totalConsumption;
      this.accessory.context.lastGasIntervalConsumption = reading.intervalConsumption;
      this.accessory.context.lastGasTotalConsumption = reading.totalConsumption;
      this.accessory.context.lastGasReadAt = reading.periodEnd.toISOString();
      this.updateCachedCharacteristics();
      await this.updateMatter();
      this.platform.api.updatePlatformAccessories([this.accessory]);
      this.platform.log.debug(
        `${this.meter.name} updated from half-hourly REST data: ${
          gasConsumptionToKWh(reading.intervalConsumption, this.meter.unit).toFixed(3)
        } kWh latest interval, ${gasConsumptionToKWh(reading.totalConsumption, this.meter.unit).toFixed(3)} kWh today`,
      );
    } catch (error) {
      this.platform.log.warn(
        `Refresh failed for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private updateCachedCharacteristics(): void {
    this.intervalConsumption?.updateValue(
      gasConsumptionToKWh(this.lastIntervalConsumption, this.meter.unit) as CharacteristicValue,
    );
    this.totalConsumption?.updateValue(
      gasConsumptionToKWh(this.lastTotalConsumption, this.meter.unit) as CharacteristicValue,
    );
  }

  private async updateMatter(): Promise<void> {
    const matter = this.platform.api.matter;
    if (!matter || !this.matterUuid) {
      return;
    }

    await matter.updateAccessoryState(
      this.matterUuid,
      matter.clusterNames.ElectricalEnergyMeasurement,
      {
        cumulativeEnergyImported: buildMatterCumulativeEnergyMeasurement(
          gasConsumptionToKWh(this.lastTotalConsumption, this.meter.unit),
          undefined,
          false,
        ),
      },
    );
  }
}
