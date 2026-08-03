import { API, Characteristic, Service, WithUUID } from 'homebridge';

export interface EveCharacteristics {
  Power: WithUUID<new () => Characteristic>;
  TotalConsumption: WithUUID<new () => Characteristic>;
  GasConsumption: WithUUID<new () => Characteristic>;
  TotalGasConsumption: WithUUID<new () => Characteristic>;
  EnergyMeterServiceUUID: string;
  GasMeterServiceUUID: string;
  createEnergyMeterService(displayName: string): Service;
  createGasMeterService(displayName: string): Service;
}

const UUID_POWER = 'E863F10A-079E-48FF-8F27-9C2605A29F52';
const UUID_TOTAL_CONSUMPTION = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

let cached: EveCharacteristics | undefined;

export function getEveCharacteristics(api: API): EveCharacteristics {
  if (cached) {
    return cached;
  }

  const { Characteristic, Formats, Perms, Service } = api.hap;

  class EvePower extends Characteristic {
    public static readonly UUID = UUID_POWER;

    constructor() {
      super('Eve Instantaneous Power', EvePower.UUID, {
        format: Formats.FLOAT,
        unit: 'W',
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        minValue: 0,
      });
    }
  }

  class EveTotalConsumption extends Characteristic {
    public static readonly UUID = UUID_TOTAL_CONSUMPTION;

    constructor() {
      super('Eve Total Consumption', EveTotalConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'kWh',
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        minValue: 0,
      });
    }
  }

  class GasConsumption extends Characteristic {
    public static readonly UUID = api.hap.uuid.generate('homebridge-octopus-energy-live:gas-consumption');

    constructor() {
      super('Gas Consumption (latest interval)', GasConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'kWh',
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        minValue: 0,
      });
    }
  }

  class TotalGasConsumption extends Characteristic {
    public static readonly UUID = api.hap.uuid.generate('homebridge-octopus-energy-live:total-gas-consumption');

    constructor() {
      super('Gas Consumption Today', TotalGasConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'kWh',
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        minValue: 0,
      });
    }
  }

  const energyMeterServiceUUID = api.hap.uuid.generate('homebridge-octopus-energy-live:energy-meter-service');
  const gasMeterServiceUUID = api.hap.uuid.generate('homebridge-octopus-energy-live:gas-meter-service');

  cached = {
    Power: EvePower,
    TotalConsumption: EveTotalConsumption,
    GasConsumption,
    TotalGasConsumption,
    EnergyMeterServiceUUID: energyMeterServiceUUID,
    GasMeterServiceUUID: gasMeterServiceUUID,
    createEnergyMeterService(displayName: string): Service {
      const service = new Service(displayName, energyMeterServiceUUID);
      service.addCharacteristic(EvePower);
      service.addCharacteristic(EveTotalConsumption);
      return service;
    },
    createGasMeterService(displayName: string): Service {
      const service = new Service(displayName, gasMeterServiceUUID);
      service.addCharacteristic(GasConsumption);
      service.addCharacteristic(TotalGasConsumption);
      return service;
    },
  };

  return cached;
}
