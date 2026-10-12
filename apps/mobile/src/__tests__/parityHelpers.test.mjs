import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Load TS helpers via dynamic transpile-free approach: re-implement import by reading compiled path
// Helpers are TypeScript — for node:test we duplicate import using a .mjs mirror

const {
  asArray,
  asNumber,
  normalizeRecipe,
  filterRecipes,
  mapApproval,
  validatePrePrep,
  computeLoss,
  validateStartProduction,
  canSubmitClosingStock,
  buildStartProductionBody,
  wasteRecordPath,
} = await import('./parityHelpers.mjs');

describe('asArray', () => {
  it('unwraps items and data wrappers', () => {
    assert.deepEqual(asArray([1, 2]), [1, 2]);
    assert.deepEqual(asArray({ items: [1] }), [1]);
    assert.deepEqual(asArray({ data: [2] }), [2]);
    assert.deepEqual(asArray(null), []);
  });
});

describe('normalizeRecipe', () => {
  it('maps snake_case and camelCase', () => {
    const r = normalizeRecipe({
      recipe_id: 'r1',
      item_id: 'SKU1',
      item_name: 'Buns',
      standard_yield: 12,
      unit: 'pcs',
      max_portions: 5,
      is_available: true,
    });
    assert.equal(r.recipeId, 'r1');
    assert.equal(r.itemId, 'SKU1');
    assert.equal(r.name, 'Buns');
    assert.equal(r.standardYield, 12);
    assert.equal(r.maxPortions, 5);
    assert.equal(r.isAvailable, true);
  });

  it('returns null without recipe id', () => {
    assert.equal(normalizeRecipe({ item_id: 'x' }), null);
  });
});

describe('filterRecipes', () => {
  const items = [
    { recipeId: '1', itemId: 'BUNS', name: 'Burger Buns', unit: 'pcs', standardYield: 1 },
    { recipeId: '2', itemId: 'OIL', name: 'Olive Oil', unit: 'L', standardYield: 1 },
  ];
  it('filters by name and sku', () => {
    assert.equal(filterRecipes(items, 'oil').length, 1);
    assert.equal(filterRecipes(items, 'BUNS').length, 1);
    assert.equal(filterRecipes(items, '').length, 2);
  });
});

describe('mapApproval', () => {
  it('maps pending approval fields', () => {
    const a = mapApproval({
      id: 'evt-1',
      type: 'waste_writeoff',
      summary: 'Write off oil',
      amount: 100,
      requestedBy: 'Jane',
      requestedAt: '2026-01-01T00:00:00.000Z',
      item_id: 'OIL',
    });
    assert.equal(a.id, 'evt-1');
    assert.equal(a.itemId, 'OIL');
    assert.equal(a.amount, 100);
  });
});

describe('validatePrePrep', () => {
  it('requires loss reason when lost > 0', () => {
    assert.match(
      validatePrePrep({
        raw_item_id: 'RAW',
        prepped_item_id: 'PREP',
        original_qty: 10,
        yielded_qty: 8,
      }) || '',
      /Loss reason/,
    );
  });
  it('accepts valid payload', () => {
    assert.equal(
      validatePrePrep({
        raw_item_id: 'RAW',
        prepped_item_id: 'PREP',
        original_qty: 10,
        yielded_qty: 8,
        loss_reason: 'trim',
      }),
      null,
    );
  });
  it('rejects yielded > original', () => {
    assert.match(
      validatePrePrep({
        raw_item_id: 'RAW',
        prepped_item_id: 'PREP',
        original_qty: 5,
        yielded_qty: 9,
        loss_reason: 'trim',
      }) || '',
      /exceed/,
    );
  });
});

describe('computeLoss', () => {
  it('computes lost qty and percent', () => {
    const { lost, lossPct } = computeLoss(10, 8);
    assert.equal(lost, 2);
    assert.equal(lossPct, 20);
  });
});

describe('validateStartProduction', () => {
  it('requires recipe_id (Nest contract)', () => {
    assert.match(
      validateStartProduction({
        item_id: 'X',
        item_name: 'X',
        planned_quantity: 1,
      }) || '',
      /Recipe/,
    );
  });
  it('accepts full body', () => {
    assert.equal(
      validateStartProduction({
        recipe_id: 'r1',
        item_id: 'SKU',
        item_name: 'Item',
        planned_quantity: 2,
      }),
      null,
    );
  });
});

describe('buildStartProductionBody', () => {
  it('includes recipe_id', () => {
    const body = buildStartProductionBody({
      recipe_id: ' abc ',
      item_id: ' sku ',
      item_name: ' Name ',
      planned_quantity: 3,
    });
    assert.equal(body.recipe_id, 'abc');
    assert.equal(body.item_id, 'sku');
    assert.equal(body.planned_quantity, 3);
  });
});

describe('canSubmitClosingStock', () => {
  it('allows MANAGER and ADMIN only', () => {
    assert.equal(canSubmitClosingStock('MANAGER'), true);
    assert.equal(canSubmitClosingStock('ADMIN'), true);
    assert.equal(canSubmitClosingStock('KITCHEN'), false);
    assert.equal(canSubmitClosingStock('POS'), false);
  });
});

describe('wasteRecordPath', () => {
  it('uses canonical /waste/record', () => {
    assert.equal(wasteRecordPath(), '/waste/record');
  });
});
