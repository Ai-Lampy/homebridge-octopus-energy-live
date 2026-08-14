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
  useLiveTelemetry?: boolean;
  homeMiniDeviceId?: string;
}

export class OctopusGasMeterAccessory {
  private readonly intervalConsumption: ReturnType<Service['getCharacteristic']> | null;
  private readonly totalConsumption: ReturnType<Service['getCharacteristic']> | null;
  private lastIntervalConsumption = 0;
  private lastTotalConsumption = 0;
  private lastValuesAreKWh = false;
  private matterCumulativeKWh = 0;
  private lastMatterIntervalEnd?: string;
  private timer?: NodeJS.Timeout;
  private liveTelemetryFailed = false;

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
    this.lastValuesAreKWh = accessory.context.lastGasValuesAreKWh === true;
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
    this.platform.log.info(
      `${this.meter.name} polling started; ${
        this.meter.useLiveTelemetry ? 'Home Mini daily usage refreshes every 30 minutes' : 'checking REST interval data'
      }.`,
    );
    void this.refreshNow();
    this.timer = setInterval(
      () => void this.refreshNow(),
      gasPollIntervalMs(this.meter.pollMinutes, this.meter.useLiveTelemetry),
    );
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
      const previousIntervalEnd = this.lastMatterIntervalEnd;
      this.lastIntervalConsumption = reading.intervalConsumption;
      this.lastTotalConsumption = reading.totalConsumption;
      this.lastValuesAreKWh = reading.valuesAreKWh === true;
      const intervalKWh = reading.valuesAreKWh
        ? reading.intervalConsumption
        : gasConsumptionToKWh(reading.intervalConsumption, this.meter.unit);
      const todayKWh = reading.valuesAreKWh
        ? reading.totalConsumption
        : gasConsumptionToKWh(reading.totalConsumption, this.meter.unit);
      const cumulative = reading.cumulativeKWh === undefined
        ? advanceCumulativeEnergy(
          this.matterCumulativeKWh,
          this.lastMatterIntervalEnd,
          intervalKWh,
          reading.periodEnd,
          todayKWh,
        )
        : {
          totalKWh: reading.cumulativeKWh,
          lastIntervalEnd: reading.periodEnd.toISOString(),
        };
      this.matterCumulativeKWh = cumulative.totalKWh;
      this.lastMatterIntervalEnd = cumulative.lastIntervalEnd;
      this.accessory.context.lastGasIntervalConsumption = reading.intervalConsumption;
      this.accessory.context.lastGasTotalConsumption = reading.totalConsumption;
      this.accessory.context.lastGasValuesAreKWh = this.lastValuesAreKWh;
      this.accessory.context.lastGasCumulativeKWh = reading.cumulativeKWh;
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
        `${this.meter.name} updated from ${reading.valuesAreKWh ? 'Home Mini gas telemetry' : 'half-hourly REST data'}: ${
          intervalKWh.toFixed(3)
        } kWh latest interval, ${todayKWh.toFixed(3)} kWh today, ${
          this.matterCumulativeKWh.toFixed(3)
        } kWh tracked cumulatively`,
      );
    } catch (error) {
      this.platform.log.warn(
        `Refresh failed for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async fetchReading() {
    if (!this.meter.useLiveTelemetry || !this.meter.homeMiniDeviceId) {
      return this.client.fetchGasIntervalReading(this.meter.mprn, this.meter.meterSerial);
    }
    try {
      const reading = await this.client.fetchGasLiveReading(this.meter.homeMiniDeviceId);
      if (this.liveTelemetryFailed) {
        this.platform.log.info(`${this.meter.name} Home Mini gas telemetry recovered.`);
      }
      this.liveTelemetryFailed = false;
      return reading;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.liveTelemetryFailed) {
        this.platform.log.warn(`${this.meter.name} Home Mini gas telemetry failed; using REST fallback: ${message}`);
      } else {
        this.platform.log.debug(`${this.meter.name} Home Mini gas telemetry still unavailable: ${message}`);
      }
      this.liveTelemetryFailed = true;
      return this.client.fetchGasIntervalReading(this.meter.mprn, this.meter.meterSerial);
    }
  }

  private updateCachedCharacteristics(): void {
    this.intervalConsumption?.updateValue(
      (this.lastValuesAreKWh
        ? this.lastIntervalConsumption
        : gasConsumptionToKWh(this.lastIntervalConsumption, this.meter.unit)) as CharacteristicValue,
    );
    this.totalConsumption?.updateValue(
      (this.lastValuesAreKWh
        ? this.lastTotalConsumption
        : gasConsumptionToKWh(this.lastTotalConsumption, this.meter.unit)) as CharacteristicValue,
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
        this.lastValuesAreKWh
          ? this.lastTotalConsumption
          : gasConsumptionToKWh(this.lastTotalConsumption, this.meter.unit),
      );
    }

    if (this.meter.useLiveTelemetry) {
      await matter.updateAccessoryState(
        this.matterUuid,
        matter.clusterNames.ElectricalPowerMeasurement,
        { activePower: null },
      );
    }

    await matter.updateAccessoryState(
      this.matterUuid,
      matter.clusterNames.ElectricalEnergyMeasurement,
      energyState,
    );
  }
}
