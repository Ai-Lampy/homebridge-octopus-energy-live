const assert = require('node:assert/strict');
const test = require('node:test');
const { kWhToMatterMilliwattHours, livePowerForSide, wattsToMatterMilliwatts } = require('../dist/energy');

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
