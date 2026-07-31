const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildMatterCumulativeEnergyMeasurement,
  kWhToMatterMilliwattHours,
  livePowerForSide,
  wattsToMatterMilliwatts,
} = require('../dist/energy');

test('splits signed Home Mini demand into import and export power', () => {
  assert.equal(livePowerForSide('import', 725.5), 725.5);
  assert.equal(livePowerForSide('export', 725.5), 0);
  assert.equal(livePowerForSide('import', -1400), 0);
  assert.equal(livePowerForSide('export', -1400), 1400);
});

test('converts API units to Matter integer units', () => {
  assert.equal(wattsToMatterMilliwatts(725.5555), 725556);
  assert.equal(kWhToMatterMilliwattHours(12.345678), 12345678);
  assert.equal(wattsToMatterMilliwatts(-1), 0);
  assert.equal(kWhToMatterMilliwattHours(-1), 0);
});

test('omits timestamps from cumulative REST fallback energy', () => {
  const staleIntervalEnd = new Date('2026-07-30T00:30:00Z');
  assert.deepEqual(buildMatterCumulativeEnergyMeasurement(1.25, staleIntervalEnd, false), {
    energy: 1250000,
  });
});

test('timestamps a true lifetime Home Mini register value', () => {
  const readAt = new Date('2026-07-31T20:50:00Z');
  assert.deepEqual(buildMatterCumulativeEnergyMeasurement(12.5, readAt, true), {
    energy: 12500000,
    endTimestamp: 1785531000,
  });
});
