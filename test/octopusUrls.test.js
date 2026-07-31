const assert = require('node:assert/strict');
const test = require('node:test');
const { buildLatestConsumptionUrl, buildTodayConsumptionUrl } = require('../dist/octopusUrls');

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
  assert.equal(url.searchParams.get('period_from'), '2026-07-31T00:00:00.000Z');
  assert.equal(url.searchParams.get('page_size'), '48');
  assert.equal(url.searchParams.get('order_by'), 'period');
});
