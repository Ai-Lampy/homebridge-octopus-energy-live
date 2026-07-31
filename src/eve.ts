import { API, Characteristic, WithUUID } from 'homebridge';

export interface EveCharacteristics {
  Power: WithUUID<new () => Characteristic>;
  TotalConsumption: WithUUID<new () => Characteristic>;
  GasConsumption: WithUUID<new () => Characteristic>;
  TotalGasConsumption: WithUUID<new () => Characteristic>;
}

const UUID_POWER = 'E863F10A-079E-48FF-8F27-9C2605A29F52';
const UUID_TOTAL_CONSUMPTION = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

let cached: EveCharacteristics | undefined;

export function getEveCharacteristics(api: API): EveCharacteristics {
  if (cached) {
    return cached;
  }

  const { Characteristic, Formats, Perms } = api.hap;

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
        unit: 'm³',
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
        unit: 'm³',
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        minValue: 0,
      });
    }
  }

  cached = {
    Power: EvePower,
    TotalConsumption: EveTotalConsumption,
    GasConsumption,
    TotalGasConsumption,
  };

  return cached;
}
