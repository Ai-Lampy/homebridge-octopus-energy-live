const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
const settings = require('../dist/settings');

test('keeps npm and Homebridge identifiers aligned', () => {
  assert.equal(packageJson.name, 'homebridge-octopus-energy-live');
  assert.equal(packageJson.displayName, 'Octopus Energy Live');
  assert.equal(settings.PLUGIN_NAME, packageJson.name);
  assert.equal(settings.PLATFORM_NAME, 'OctopusEnergyLive');
  assert.equal(schema.pluginAlias, settings.PLATFORM_NAME);
  assert.equal(packageJson.homebridge.platforms[0].platform, settings.PLATFORM_NAME);
});

test('declares the transports and supported Node.js versions', () => {
  assert(packageJson.keywords.includes('homebridge-plugin'));
  assert(packageJson.keywords.includes('supports-hap'));
  assert(packageJson.keywords.includes('supports-matter'));
  assert.equal(packageJson.engines.node, '^22.10.0 || ^24.0.0');
});

test('includes release notes in the published package', () => {
  assert(packageJson.files.includes('CHANGELOG.md'));
  assert(fs.existsSync(path.join(root, 'CHANGELOG.md')));
});

test('labels electricity accurately and provides optional gas settings', () => {
  assert.equal(schema.schema.properties.import.title, 'Electricity Meter');
  assert.equal(schema.schema.properties.gas.title, 'Gas Meter (Optional)');
  assert(schema.schema.properties.gas.properties.mprn);
  assert(schema.schema.properties.gas.properties.meterSerial);
  assert(!schema.schema.required.includes('gas'));
});
