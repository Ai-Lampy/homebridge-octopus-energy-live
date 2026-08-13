const assert = require('node:assert/strict');
const test = require('node:test');
const {
  gasPollIntervalMs,
  gasConsumptionToKWh,
  normaliseGasConsumptionUnit,
  parseGasTelemetry,
} = require('../dist/gas');

test('checks for newly published gas intervals every five minutes by default', () => {
  assert.equal(gasPollIntervalMs(undefined), 5 * 60 * 1000);
  assert.equal(gasPollIntervalMs(10), 10 * 60 * 1000);
  assert.equal(gasPollIntervalMs(1), 5 * 60 * 1000);
  assert.equal(gasPollIntervalMs(60), 30 * 60 * 1000);
});

test('calculates gas used today from cumulative Home Mini telemetry', () => {
  const reading = parseGasTelemetry([
    { readAt: '2026-08-13T00:00:00+01:00', consumption: '500000', demand: '0' },
    { readAt: '2026-08-13T08:00:00+01:00', consumption: '500420', demand: '25' },
    { readAt: '2026-08-13T12:00:00+01:00', consumption: '500860', consumptionDelta: '440', demand: '40' },
  ]);

  assert.equal(reading.todayKWh, 0.86);
  assert.equal(reading.intervalKWh, 0.44);
  assert.equal(reading.cumulativeKWh, 500.86);
  assert.equal(reading.demandWatts, 40);
  assert.equal(reading.periodEnd.toISOString(), '2026-08-13T11:00:00.000Z');
});

test('rejects incomplete gas telemetry so REST can take over', () => {
  assert.throws(
    () => parseGasTelemetry([{ readAt: '2026-08-13T12:00:00Z', consumption: 500000 }]),
    /Not enough Home Mini gas telemetry/,
  );
});

test('normalises Octopus gas consumption units', () => {
  assert.equal(normaliseGasConsumptionUnit('kWh'), 'kWh');
  assert.equal(normaliseGasConsumptionUnit('m3'), 'm³');
  assert.equal(normaliseGasConsumptionUnit('cubic metres'), 'm³');
  assert.throws(() => normaliseGasConsumptionUnit(undefined), /unknown gas consumption unit/);
});

test('publishes gas energy in kWh without relabelling cubic metres', () => {
  assert.equal(gasConsumptionToKWh(2.5, 'kWh'), 2.5);
  assert.equal(Math.round(gasConsumptionToKWh(1, 'm³') * 1000) / 1000, 11.135);
  assert.equal(gasConsumptionToKWh(-1, 'kWh'), 0);
});
