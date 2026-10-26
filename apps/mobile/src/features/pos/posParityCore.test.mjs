
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAvailabilityOntoMenus,
  isMenuSellable,
  buildLineSelections,
  normalizeBootstrapMenus,
  normalizeMenuLines,
  choiceLinesNeedingPick,
  validateLineSelections,
} from './posParityCore.mjs';

describe('mergeAvailabilityOntoMenus', () => {
  it('overlays maxPortions', () => {
    const out = mergeAvailabilityOntoMenus(
      [{ menuId: 'm1', maxPortions: 99 }, { menuId: 'm2', maxPortions: 10 }],
      [{ menuItemId: 'm1', maxPortions: 3 }, { menuItemId: 'm2', maxPortions: 0, isAvailable: false }],
    );
    assert.equal(out[0].maxPortions, 3);
    assert.equal(out[1].isAvailable, false);
  });
});

describe('isMenuSellable', () => {
  it('no default of 1', () => {
    assert.equal(isMenuSellable({ isAvailable: true }), false);
    assert.equal(isMenuSellable({ maxPortions: 2, isAvailable: true }), true);
  });
});

describe('normalizeMenuLines', () => {
  it('maps snake_case and option_items', () => {
    const lines = normalizeMenuLines([
      {
        component_key: 'drink',
        component_type: 'CHOICE',
        quantity_required: 1,
        option_items: [{ finished_good_id: 'A', finished_good_name: 'Cola', available_stock: 5 }],
      },
    ]);
    assert.equal(lines[0].componentKey, 'drink');
    assert.equal(lines[0].componentType, 'CHOICE');
    assert.equal(lines[0].options[0].finishedGoodId, 'A');
    assert.equal(lines[0].options[0].availableStock, 5);
  });
});

describe('buildLineSelections + validate', () => {
  it('FIXED auto', () => {
    const sel = buildLineSelections(
      [{ componentKey: 'f', componentType: 'FIXED', finishedGoodId: 'SKU', quantityRequired: 1 }],
      2,
    );
    assert.equal(sel[0].quantity, 2);
  });
  it('multi CHOICE with preferred', () => {
    const lines = [
      {
        componentKey: 'drink',
        componentType: 'CHOICE',
        quantityRequired: 1,
        options: [
          { finishedGoodId: 'A', finishedGoodName: 'A' },
          { finishedGoodId: 'B', finishedGoodName: 'B' },
        ],
      },
    ];
    assert.equal(buildLineSelections(lines, 1), null);
    assert.equal(choiceLinesNeedingPick(lines).length, 1);
    const sel = buildLineSelections(lines, 1, { drink: 'B' });
    assert.equal(sel[0].finished_good_id, 'B');
    assert.equal(validateLineSelections('Meal', lines, sel, 1), null);
  });
  it('validate catches missing CHOICE', () => {
    const lines = [
      {
        componentKey: 'drink',
        componentType: 'CHOICE',
        finishedGoodCategoryName: 'Drink',
        quantityRequired: 1,
        options: [{ finishedGoodId: 'A' }, { finishedGoodId: 'B' }],
      },
    ];
    const msg = validateLineSelections('Meal', lines, [], 1);
    assert.match(msg, /needs 1/);
  });
});

describe('normalizeBootstrapMenus', () => {
  it('filters invisible + merges + normalizes lines', () => {
    const out = normalizeBootstrapMenus({
      menus: [
        {
          menuId: 'a',
          isVisible: true,
          maxPortions: 1,
          lines: [{ component_key: 'x', component_type: 'FIXED', finished_good_id: 'S1' }],
        },
        { menuId: 'b', isVisible: false, maxPortions: 1 },
      ],
      availability: [{ menuItemId: 'a', maxPortions: 4 }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].maxPortions, 4);
    assert.equal(out[0].lines[0].finishedGoodId, 'S1');
  });
});

function buildSubmitLines(counts, itemIds) {
  return itemIds
    .map((id) => {
      const raw = (counts[id] ?? '').trim();
      if (raw === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return null;
      return { itemId: id, countedQty: n };
    })
    .filter(Boolean);
}

describe('closing stock', () => {
  it('zero valid', () => {
    assert.deepEqual(buildSubmitLines({ a: '0', b: '' }, ['a', 'b']), [
      { itemId: 'a', countedQty: 0 },
    ]);
  });
});
