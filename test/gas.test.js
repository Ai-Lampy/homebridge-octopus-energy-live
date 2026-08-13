const assert = require('node:assert/strict');
const test = require('node:test');
const {
  gasPollIntervalMs,
  gasConsumptionToKWh,
  normaliseGasConsumptionUnit,
} = require('../dist/gas');

test('checks for newly published gas intervals every five minutes by default', () => {
  assert.equal(gasPollIntervalMs(undefined), 5 * 60 * 1000);
  assert.equal(gasPollIntervalMs(10), 10 * 60 * 1000);
  assert.equal(gasPollIntervalMs(1), 5 * 60 * 1000);
  assert.equal(gasPollIntervalMs(60), 30 * 60 * 1000);
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
