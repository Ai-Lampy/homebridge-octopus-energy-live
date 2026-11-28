const assert = require('node:assert/strict');
const test = require('node:test');
const { OctopusApiClient } = require('../dist/octopusApi');

function clientWithResponse(body, status = 200) {
  const client = new OctopusApiClient('not-a-real-key', { debug() {} });
  client.token = 'test-token';
  client.tokenExpiresAt = Date.now() + 3600000;
  const calls = [];
  client.fetchWithTimeout = async (url, init) => {
    calls.push({ url, init });
    return { ok: status === 200, status, json: async () => body };
  };
  return { client, calls };
}

test('telemetry request uses new host and rejects stale data', async () => {
  const { client, calls } = clientWithResponse({ data: { smartMeterTelemetry: [
    { readAt: '2020-01-01T00:00:00Z', demand: '123', consumption: '1000' },
  ] } });
  await assert.rejects(client.fetchLiveTelemetryUncached('AA-BB-CC-DD-EE-FF-00-11'), /older than five minutes/);
  assert.equal(calls[0].url, 'https://api.oegb-kraken.energy/v1/graphql/');
});

test('shared budget counts gas/electricity requests and stops at 110', async () => {
  const { client, calls } = clientWithResponse({ data: {} });
  for (let i = 0; i < 110; i++) await client.fetchGraphQL('smartMeterTelemetry(', {});
  await assert.rejects(client.fetchGraphQL('smartMeterTelemetry(', {}), /budget exhausted/);
  assert.equal(calls.length, 110);
  client.telemetryRequests.fill(Date.now() - 3600001);
  await client.fetchGraphQL('smartMeterTelemetry(', {});
  assert.equal(calls.length, 111);
});

test('HTTP and GraphQL throttling pause subsequent telemetry', async () => {
  for (const [body, status] of [[{}, 429], [{ errors: [{ message: 'Too many requests. Please wait.' }] }, 200]]) {
    const { client, calls } = clientWithResponse(body, status);
    try { await client.fetchGraphQL('smartMeterTelemetry(', {}); } catch {}
    await assert.rejects(client.fetchGraphQL('smartMeterTelemetry(', {}), /cooldown active/);
    assert.equal(calls.length, 1);
  }
});

test('null or empty demand is not treated as zero', () => {
  const { client } = clientWithResponse({});
  for (const value of [null, undefined, '', ' ']) assert.throws(() => client.parseNumber(value, 'demand'));
  assert.equal(client.parseNumber('0', 'demand'), 0);
  assert.equal(client.parseOptionalNumber(null), undefined);
});
