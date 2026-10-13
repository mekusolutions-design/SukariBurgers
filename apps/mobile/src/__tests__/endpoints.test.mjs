import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const endpointsSrc = readFileSync(
  join(__dirname, '../api/endpoints.ts'),
  'utf8',
);

describe('API_ENDPOINTS source contract', () => {
  it('defines pre-prep kitchen path', () => {
    assert.match(endpointsSrc, /KITCHEN_PRE_PREP:\s*'\/kitchen\/pre-prep'/);
  });
  it('defines waste as /waste/record', () => {
    assert.match(endpointsSrc, /WASTE_RECORD:\s*'\/waste\/record'/);
    assert.doesNotMatch(endpointsSrc, /LOG_WASTE:\s*'\/waste'/);
  });
  it('defines recipe list and production start', () => {
    assert.match(endpointsSrc, /RECIPE_LIST:\s*'\/recipe'/);
    assert.match(endpointsSrc, /PRODUCTION_START:\s*'\/production\/start'/);
  });
  it('defines approvals and dashboard', () => {
    assert.match(endpointsSrc, /APPROVALS_PENDING:\s*'\/approvals\/pending'/);
    assert.match(endpointsSrc, /DASHBOARD_SUMMARY:\s*'\/dashboard\/summary'/);
  });
  it('defines closing stock', () => {
    assert.match(endpointsSrc, /KITCHEN_CLOSING_STOCK:\s*'\/kitchen\/closing-stock'/);
  });
});


describe('mobile parity endpoints', () => {
  it('defines the inventory suggestion endpoint used by receiving', () => {
    assert.match(endpointsSrc, /INVENTORY_SUGGEST:\s*'\/inventory\/suggest'/);
    assert.match(endpointsSrc, /MENU_CATEGORIES:\s*'\/menu\/categories'/);
  });
});
