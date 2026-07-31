const assert = require('node:assert/strict');
const test = require('node:test');
const { GAS_POLL_INTERVAL_MS, normaliseGasConsumptionUnit } = require('../dist/gas');

test('polls gas at the source half-hour interval', () => {
  assert.equal(GAS_POLL_INTERVAL_MS, 30 * 60 * 1000);
});

test('normalises Octopus gas consumption units', () => {
  assert.equal(normaliseGasConsumptionUnit('kWh'), 'kWh');
  assert.equal(normaliseGasConsumptionUnit('m3'), 'm³');
  assert.equal(normaliseGasConsumptionUnit('cubic metres'), 'm³');
  assert.throws(() => normaliseGasConsumptionUnit(undefined), /unknown gas consumption unit/);
});
