// apps/mobile/src/features/pos/posParityCore.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAvailabilityOntoMenus,
  isMenuSellable,
  buildLineSelections,
  normalizeBootstrapMenus,
} from './posParityCore';

describe('mergeAvailabilityOntoMenus', () => {
  it('overlays maxPortions from availability[]', () => {
    const menus = [
      { menuId: 'm1', name: 'Soda', maxPortions: 99, isAvailable: true },
      { menuId: 'm2', name: 'Burger', maxPortions: 10, isAvailable: true },
    ];
    const availability = [
      { menuItemId: 'm1', maxPortions: 3, isAvailable: true },
      { menuItemId: 'm2', maxPortions: 0, isAvailable: false },
    ];
    const out = mergeAvailabilityOntoMenus(menus, availability);
    assert.equal(out[0].maxPortions, 3);
    assert.equal(out[0].isAvailable, true);
    assert.equal(out[1].maxPortions, 0);
    assert.equal(out[1].isAvailable, false);
  });
});

describe('isMenuSellable', () => {
  it('rejects missing/zero maxPortions (no fake default of 1)', () => {
    assert.equal(isMenuSellable({ isAvailable: true }), false);
    assert.equal(isMenuSellable({ maxPortions: 0, isAvailable: true }), false);
    assert.equal(isMenuSellable({ maxPortions: 2, isAvailable: true }), true);
    assert.equal(isMenuSellable({ maxPortions: 5, isAvailable: false }), false);
  });
});

describe('buildLineSelections', () => {
  it('auto-selects FIXED finished good', () => {
    const sel = buildLineSelections(
      [
        {
          componentKey: 'fixed-soda',
          componentType: 'FIXED',
          finishedGoodId: 'SKU-SODA',
          finishedGoodName: '300ml Soda',
          quantityRequired: 1,
        },
      ],
      2,
    );
    assert.ok(sel);
    assert.equal(sel!.length, 1);
    assert.equal(sel![0].finished_good_id, 'SKU-SODA');
    assert.equal(sel![0].quantity, 2);
    assert.equal(sel![0].component_key, 'fixed-soda');
  });

  it('auto-selects single-option CHOICE', () => {
    const sel = buildLineSelections(
      [
        {
          componentKey: 'drink',
          componentType: 'CHOICE',
          quantityRequired: 1,
          options: [{ finishedGoodId: 'SKU-A', finishedGoodName: 'A' }],
        },
      ],
      1,
    );
    assert.ok(sel);
    assert.equal(sel![0].finished_good_id, 'SKU-A');
  });

  it('returns null for multi-option CHOICE without preference', () => {
    const sel = buildLineSelections(
      [
        {
          componentKey: 'drink',
          componentType: 'CHOICE',
          quantityRequired: 1,
          options: [
            { finishedGoodId: 'SKU-A' },
            { finishedGoodId: 'SKU-B' },
          ],
        },
      ],
      1,
    );
    assert.equal(sel, null);
  });

  it('returns null for unlinked FIXED', () => {
    const sel = buildLineSelections(
      [
        {
          componentKey: 'line-123',
          componentType: 'FIXED',
          finishedGoodId: null,
          quantityRequired: 1,
        },
      ],
      1,
    );
    assert.equal(sel, null);
  });
});

describe('normalizeBootstrapMenus', () => {
  it('applies availability and filters invisible', () => {
    const out = normalizeBootstrapMenus({
      menus: [
        { menuId: 'a', name: 'A', maxPortions: 1, isVisible: true },
        { menuId: 'b', name: 'B', maxPortions: 1, isVisible: false },
      ],
      availability: [{ menuItemId: 'a', maxPortions: 4, isAvailable: true }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].maxPortions, 4);
  });
});
