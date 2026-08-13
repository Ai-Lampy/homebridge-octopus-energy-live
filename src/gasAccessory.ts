import { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { OctopusEnergyLivePlatform } from './platform';
import { OctopusApiClient } from './octopusApi';
import {
  advanceCumulativeEnergy,
  buildMatterCumulativeEnergyMeasurement,
  buildMatterDailyEnergyMeasurement,
} from './energy';
import { GasConsumptionUnit, gasConsumptionToKWh, gasPollIntervalMs } from './gas';

export interface GasMeterConfig {
  name: string;
  mprn: string;
  meterSerial: string;
  unit: GasConsumptionUnit;
  pollMinutes?: number;
  exposeDailyUsageToMatter?: boolean;
}

export class OctopusGasMeterAccessory {
  private readonly intervalConsumption: ReturnType<Service['getCharacteristic']> | null;
  private readonly totalConsumption: ReturnType<Service['getCharacteristic']> | null;
  private lastIntervalConsumption = 0;
  private lastTotalConsumption = 0;
  private matterCumulativeKWh = 0;
  private lastMatterIntervalEnd?: string;
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
    this.removeLegacyOutletCharacteristic(outlet, this.platform.Eve.GasConsumption);
    this.removeLegacyOutletCharacteristic(outlet, this.platform.Eve.TotalGasConsumption);
    const gasService = this.accessory.services.find(
      (service) => service.UUID === this.platform.Eve.GasMeterServiceUUID,
    )
      || this.accessory.addService(this.platform.Eve.createGasMeterService(`${meter.name} Usage`));
    this.intervalConsumption = gasService.getCharacteristic(this.platform.Eve.GasConsumption);
    this.totalConsumption = gasService.getCharacteristic(this.platform.Eve.TotalGasConsumption);
    this.intervalConsumption?.setProps({ unit: 'kWh' });
    this.totalConsumption?.setProps({ unit: 'kWh' });

    this.lastIntervalConsumption = typeof accessory.context.lastGasIntervalConsumption === 'number'
      ? accessory.context.lastGasIntervalConsumption
      : 0;
    this.lastTotalConsumption = typeof accessory.context.lastGasTotalConsumption === 'number'
      ? accessory.context.lastGasTotalConsumption
      : 0;
    this.matterCumulativeKWh = typeof accessory.context.matterGasCumulativeKWh === 'number'
      ? accessory.context.matterGasCumulativeKWh
      : gasConsumptionToKWh(this.lastTotalConsumption, this.meter.unit);
    this.lastMatterIntervalEnd = typeof accessory.context.lastMatterGasIntervalEnd === 'string'
      ? accessory.context.lastMatterGasIntervalEnd
      : accessory.context.lastGasReadAt;
    this.updateCachedCharacteristics();
  }

  public startPolling(): void {
    if (this.timer) {
      return;
    }
    void this.refreshNow();
    this.timer = setInterval(() => void this.refreshNow(), gasPollIntervalMs(this.meter.pollMinutes));
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
      const reading = await this.client.fetchGasIntervalReading(this.meter.mprn, this.meter.meterSerial);
      const previousIntervalEnd = this.lastMatterIntervalEnd;
      this.lastIntervalConsumption = reading.intervalConsumption;
      this.lastTotalConsumption = reading.totalConsumption;
      const intervalKWh = gasConsumptionToKWh(reading.intervalConsumption, this.meter.unit);
      const cumulative = advanceCumulativeEnergy(
        this.matterCumulativeKWh,
        this.lastMatterIntervalEnd,
        intervalKWh,
        reading.periodEnd,
        gasConsumptionToKWh(reading.totalConsumption, this.meter.unit),
      );
      this.matterCumulativeKWh = cumulative.totalKWh;
      this.lastMatterIntervalEnd = cumulative.lastIntervalEnd;
      this.accessory.context.lastGasIntervalConsumption = reading.intervalConsumption;
      this.accessory.context.lastGasTotalConsumption = reading.totalConsumption;
      this.accessory.context.lastGasReadAt = reading.periodEnd.toISOString();
      this.accessory.context.matterGasCumulativeKWh = this.matterCumulativeKWh;
      this.accessory.context.lastMatterGasIntervalEnd = this.lastMatterIntervalEnd;
      this.updateCachedCharacteristics();
      const isNewInterval = !previousIntervalEnd
        || reading.periodEnd.getTime() > new Date(previousIntervalEnd).getTime();
      if (isNewInterval || this.meter.exposeDailyUsageToMatter) {
        await this.updateMatter();
      }
      this.platform.api.updatePlatformAccessories([this.accessory]);
      this.platform.log.info(
        `${this.meter.name} updated from half-hourly REST data: ${
          intervalKWh.toFixed(3)
        } kWh latest interval, ${gasConsumptionToKWh(reading.totalConsumption, this.meter.unit).toFixed(3)} kWh today, ${
          this.matterCumulativeKWh.toFixed(3)
        } kWh tracked cumulatively`,
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

    const energyState: Record<string, unknown> = {
      cumulativeEnergyImported: buildMatterCumulativeEnergyMeasurement(
        this.matterCumulativeKWh,
        undefined,
        false,
      ),
    };
    if (this.meter.exposeDailyUsageToMatter) {
      energyState.periodicEnergyImported = buildMatterDailyEnergyMeasurement(
        gasConsumptionToKWh(this.lastTotalConsumption, this.meter.unit),
      );
    }

    await matter.updateAccessoryState(
      this.matterUuid,
      matter.clusterNames.ElectricalEnergyMeasurement,
      energyState,
    );
  }
}
