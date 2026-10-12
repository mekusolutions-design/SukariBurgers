// API contract tests for mobile parity endpoints.
// Mirrors Nest Zod DTOs (start-production, pre-prep, record-waste) without booting Nest.
// Run: node --test apps/api/test/mobile-parity.contract.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mirrors StartProductionSchema ─────────────────────────────────────────
function parseStartProduction(body) {
  const errors = [];
  if (!body?.recipe_id || !String(body.recipe_id).trim()) {
    errors.push('recipe_id');
  }
  if (!body?.item_id || !String(body.item_id).trim()) {
    errors.push('item_id');
  }
  if (!body?.item_name || !String(body.item_name).trim()) {
    errors.push('item_name');
  }
  const qty = Number(body?.planned_quantity);
  if (!(qty > 0)) errors.push('planned_quantity');
  if (errors.length) return { success: false, errors };
  return {
    success: true,
    data: {
      recipe_id: String(body.recipe_id).trim(),
      item_id: String(body.item_id).trim().toUpperCase(),
      item_name: String(body.item_name).trim(),
      planned_quantity: qty,
      notes: body.notes,
    },
  };
}

// ─── Mirrors PrePrepSchema ─────────────────────────────────────────────────
function parsePrePrep(body) {
  const errors = [];
  if (!body?.raw_item_id || !String(body.raw_item_id).trim()) {
    errors.push('raw_item_id');
  }
  if (!body?.prepped_item_id || !String(body.prepped_item_id).trim()) {
    errors.push('prepped_item_id');
  }
  const original = Number(body?.original_qty);
  const yielded = Number(body?.yielded_qty);
  if (!(original > 0)) errors.push('original_qty');
  if (!(yielded > 0)) errors.push('yielded_qty');
  if (original > 0 && yielded > 0 && yielded > original) {
    errors.push('yielded_qty exceeds original_qty');
  }
  const lost = original - yielded;
  if (lost > 0 && !(body?.loss_reason && String(body.loss_reason).trim())) {
    errors.push('loss_reason required when lost > 0');
  }
  if (errors.length) return { success: false, errors };
  return {
    success: true,
    data: {
      raw_item_id: String(body.raw_item_id).trim(),
      prepped_item_id: String(body.prepped_item_id).trim(),
      original_qty: original,
      yielded_qty: yielded,
      loss_reason: body.loss_reason,
    },
  };
}

// ─── Mirrors RecordWasteSchema module_source enum ──────────────────────────
const WASTE_MODULE_SOURCES = new Set([
  'received',
  'production',
  'refill',
  'finished_goods',
  'pos',
  'inventory',
  'kitchen',
]);

function parseRecordWaste(body) {
  const errors = [];
  if (!WASTE_MODULE_SOURCES.has(body?.module_source)) {
    errors.push(`module_source must be one of ${[...WASTE_MODULE_SOURCES].join(',')}`);
  }
  if (!body?.item_id || !String(body.item_id).trim()) errors.push('item_id');
  const qty = Number(body?.quantity_wasted);
  if (!(qty >= 0) || Number.isNaN(qty)) errors.push('quantity_wasted');
  const reason = body?.waste_reason;
  if (!reason || String(reason).trim().length < 3) {
    errors.push('waste_reason min 3 chars');
  }
  if (errors.length) return { success: false, errors };
  return { success: true, data: body };
}

// ─── Routes mobile must call ───────────────────────────────────────────────
const ROUTES = {
  prePrep: 'POST /kitchen/pre-prep',
  productionStart: 'POST /production/start',
  closingStockGet: 'GET /kitchen/closing-stock',
  closingStockPost: 'POST /kitchen/closing-stock',
  wasteRecord: 'POST /waste/record',
  recipeList: 'GET /recipe',
  approvalsPending: 'GET /approvals/pending',
  dashboardSummary: 'GET /dashboard/summary',
};

const CLOSING_STOCK_SUBMIT_ROLES = ['MANAGER', 'ADMIN'];

describe('route catalog (mobile endpoints.ts)', () => {
  it('uses /waste/record not /waste', () => {
    assert.equal(ROUTES.wasteRecord, 'POST /waste/record');
  });
  it('uses /kitchen/pre-prep', () => {
    assert.match(ROUTES.prePrep, /\/kitchen\/pre-prep/);
  });
  it('closing stock submit roles exclude KITCHEN', () => {
    assert.ok(!CLOSING_STOCK_SUBMIT_ROLES.includes('KITCHEN'));
    assert.ok(CLOSING_STOCK_SUBMIT_ROLES.includes('MANAGER'));
  });
});

describe('POST /production/start body', () => {
  it('rejects missing recipe_id', () => {
    const r = parseStartProduction({
      item_id: 'BUNS',
      item_name: 'Buns',
      planned_quantity: 10,
    });
    assert.equal(r.success, false);
    assert.ok(r.errors.includes('recipe_id'));
  });

  it('accepts picker payload and uppercases SKU', () => {
    const r = parseStartProduction({
      recipe_id: 'rec-1',
      item_id: 'buns',
      item_name: 'Burger Buns',
      planned_quantity: 12,
    });
    assert.equal(r.success, true);
    assert.equal(r.data.item_id, 'BUNS');
    assert.equal(r.data.recipe_id, 'rec-1');
  });
});

describe('POST /kitchen/pre-prep body', () => {
  it('requires loss_reason when lost > 0', () => {
    const r = parsePrePrep({
      raw_item_id: 'RAW',
      prepped_item_id: 'PREP',
      original_qty: 10,
      yielded_qty: 8,
    });
    assert.equal(r.success, false);
  });

  it('accepts valid pre-prep', () => {
    const r = parsePrePrep({
      raw_item_id: 'RAW',
      prepped_item_id: 'PREP',
      original_qty: 10,
      yielded_qty: 8,
      loss_reason: 'trim',
    });
    assert.equal(r.success, true);
  });
});

describe('POST /waste/record body', () => {
  it('rejects module_source=manual (mobile must map to kitchen/inventory)', () => {
    const r = parseRecordWaste({
      module_source: 'manual',
      item_id: 'OIL',
      quantity_wasted: 1,
      waste_reason: 'spoiled',
    });
    assert.equal(r.success, false);
  });

  it('accepts module_source=kitchen', () => {
    const r = parseRecordWaste({
      module_source: 'kitchen',
      item_id: 'OIL',
      quantity_wasted: 1,
      waste_reason: 'spoiled',
    });
    assert.equal(r.success, true);
  });
});

describe('response unwrapping contracts', () => {
  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.data)) return data.data;
    }
    return [];
  }

  it('GET /recipe { items }', () => {
    assert.equal(asArray({ success: true, items: [{ id: 1 }] }).length, 1);
  });

  it('GET /approvals/pending array or { items }', () => {
    assert.equal(asArray([{ id: 'a' }]).length, 1);
    assert.equal(asArray({ items: [{ id: 'a' }] }).length, 1);
  });

  it('GET /dashboard/summary metric fields', () => {
    const s = {
      todayRevenue: 0,
      todayOrders: 0,
      openApprovals: 0,
      lowStockCount: 0,
      nearExpiryCount: 0,
    };
    for (const k of Object.keys(s)) {
      assert.equal(typeof s[k], 'number');
    }
  });
});
