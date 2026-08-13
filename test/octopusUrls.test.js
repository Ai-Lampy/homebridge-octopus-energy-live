const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildLatestConsumptionUrl,
  buildLatestGasConsumptionUrl,
  buildTodayConsumptionUrl,
  buildTodayGasConsumptionUrl,
} = require('../dist/octopusUrls');

test('builds a latest-reading URL with encoded meter identifiers', () => {
  const url = new URL(buildLatestConsumptionUrl(' 12 34 ', 'A/B'));
  assert.equal(url.pathname, '/v1/electricity-meter-points/12%2034/meters/A%2FB/consumption/');
  assert.equal(url.searchParams.get('page_size'), '1');
  assert.equal(url.searchParams.get('order_by'), '-period');
});

test('builds a bounded daily-consumption URL', () => {
  const url = new URL(buildTodayConsumptionUrl('123', 'ABC', {
    now: new Date('2026-07-31T18:45:00Z'),
    pageSize: 48,
  }));
  assert.equal(url.searchParams.get('period_from'), '2026-07-30T23:00:00.000Z');
  assert.equal(url.searchParams.get('page_size'), '48');
  assert.equal(url.searchParams.get('order_by'), 'period');
});

test('builds gas URLs with an MPRN and encoded serial', () => {
  const latest = new URL(buildLatestGasConsumptionUrl(' 98 76 ', 'G/123'));
  assert.equal(latest.pathname, '/v1/gas-meter-points/98%2076/meters/G%2F123/consumption/');
  assert.equal(latest.searchParams.get('page_size'), '1');
  assert.equal(latest.searchParams.get('order_by'), '-period');

  const today = new URL(buildTodayGasConsumptionUrl('9876', 'G123', {
    now: new Date('2026-07-31T18:45:00Z'),
    pageSize: 48,
  }));
  assert.equal(today.searchParams.get('period_from'), '2026-07-30T23:00:00.000Z');
  assert.equal(today.searchParams.get('page_size'), '48');
  assert.equal(today.searchParams.get('order_by'), 'period');
});
