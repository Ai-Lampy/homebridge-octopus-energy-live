const assert = require('node:assert/strict');
const test = require('node:test');
const { normaliseDeviceId, isFreshTelemetry, lifetimeEnergy, OCTOPUS_API_BASE } = require('../dist/telemetry');

test('validates EUI64 overrides without exposing their values', () => {
  assert.equal(normaliseDeviceId('aa:bb:cc:dd:ee:ff:00:11'), 'AA-BB-CC-DD-EE-FF-00-11');
  assert.equal(normaliseDeviceId(' aabbccddeeff0011 '), 'AA-BB-CC-DD-EE-FF-00-11');
  assert.throws(() => normaliseDeviceId('1234567890123'), /Clear the manual override/);
  assert.equal(OCTOPUS_API_BASE, 'https://api.oegb-kraken.energy/v1');
});

test('rejects stale, missing, invalid and future live readings', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  assert(isFreshTelemetry('2026-11-28T11:59:30Z', now));
  for (const value of [undefined, '', 'invalid', '2026-11-28T11:54:59Z', '2026-11-28T12:01:01Z']) {
    assert.equal(isFreshTelemetry(value, now), false);
  }
});

test('daily fallback never replaces lifetime electricity energy', () => {
  assert.equal(lifetimeEnergy(12000, 2.5, false), 12000);
  assert.equal(lifetimeEnergy(12000, 0, false), 12000);
  assert.equal(lifetimeEnergy(12000, 12001, true), 12001);
  assert.equal(lifetimeEnergy(12001, 100, true), 12001);
  assert.equal(lifetimeEnergy(undefined, 2.5, false), undefined);
  assert.equal(lifetimeEnergy(undefined, 12000, true), 12000);
});
