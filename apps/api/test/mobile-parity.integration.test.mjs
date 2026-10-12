/**
 * Integration tests: mobile client request shaping → Nest DTO rules →
 * mock service outcomes → mobile response unwrapping.
 *
 * Does not require Postgres or Nest boot.
 * Run: node --test apps/api/test/mobile-parity.integration.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Shared parsers (Nest DTO mirrors) ─────────────────────────────────────

function parseStartProduction(body) {
  const errors = [];
  if (!body?.recipe_id || !String(body.recipe_id).trim()) errors.push('recipe_id');
  if (!body?.item_id || !String(body.item_id).trim()) errors.push('item_id');
  if (!body?.item_name || !String(body.item_name).trim()) errors.push('item_name');
  const qty = Number(body?.planned_quantity);
  if (!(qty > 0)) errors.push('planned_quantity');
  if (errors.length) return { ok: false, status: 400, errors };
  return {
    ok: true,
    data: {
      recipe_id: String(body.recipe_id).trim(),
      item_id: String(body.item_id).trim().toUpperCase(),
      item_name: String(body.item_name).trim(),
      planned_quantity: qty,
      notes: body.notes,
    },
  };
}

function parsePrePrep(body) {
  const errors = [];
  if (!body?.raw_item_id?.toString().trim()) errors.push('raw_item_id');
  if (!body?.prepped_item_id?.toString().trim()) errors.push('prepped_item_id');
  const original = Number(body?.original_qty);
  const yielded = Number(body?.yielded_qty);
  if (!(original > 0)) errors.push('original_qty');
  if (!(yielded > 0)) errors.push('yielded_qty');
  if (original > 0 && yielded > original) errors.push('yielded_qty');
  const lost = original - yielded;
  if (lost > 0 && !String(body?.loss_reason || '').trim()) errors.push('loss_reason');
  if (errors.length) return { ok: false, status: 400, errors };
  return {
    ok: true,
    data: {
      raw_item_id: String(body.raw_item_id).trim(),
      prepped_item_id: String(body.prepped_item_id).trim(),
      original_qty: original,
      yielded_qty: yielded,
      loss_reason: body.loss_reason,
      unit: body.unit || 'kg',
    },
  };
}

const WASTE_SOURCES = new Set([
  'received', 'production', 'refill', 'finished_goods', 'pos', 'inventory', 'kitchen',
]);

function parseWaste(body) {
  const errors = [];
  if (!WASTE_SOURCES.has(body?.module_source)) errors.push('module_source');
  if (!body?.item_id) errors.push('item_id');
  if (!(Number(body?.quantity_wasted) >= 0)) errors.push('quantity_wasted');
  if (!body?.waste_reason || String(body.waste_reason).length < 3) {
    errors.push('waste_reason');
  }
  if (errors.length) return { ok: false, status: 400, errors };
  return { ok: true, data: body };
}

function canSubmitClosingStock(role) {
  return role === 'MANAGER' || role === 'ADMIN';
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
}

// ─── Mock in-memory API (integration stand-in for Nest + Prisma) ───────────

function createMockApi() {
  const state = {
    events: [],
    stock: new Map([
      ['CHICKEN-RAW', { qty: 50, unit_cost: 10 }],
      ['CHICKEN-PREP', { qty: 0, unit_cost: 0 }],
      ['BUNS', { qty: 100, unit_cost: 5 }],
    ]),
    recipes: [
      {
        recipeId: 'rec-buns',
        item_id: 'BUNS',
        item_name: 'Burger Buns',
        standard_yield: 12,
        unit: 'pcs',
        max_portions: 8,
        is_available: true,
      },
    ],
    approvals: [
      {
        id: 'appr-1',
        type: 'waste_writeoff',
        summary: 'Write off oil',
        amount: 200,
        requestedBy: 'Chef',
        requestedAt: '2026-10-01T10:00:00.000Z',
        itemId: 'OIL',
      },
    ],
    productions: [],
  };

  return {
    state,
    handle(method, path, { body, role, shopId } = {}) {
      const key = `${method} ${path}`;

      if (key === 'GET /recipe') {
        return { status: 200, body: { success: true, items: state.recipes, total: state.recipes.length } };
      }

      if (key === 'POST /production/start') {
        if (!['KITCHEN', 'MANAGER', 'ADMIN'].includes(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        const parsed = parseStartProduction(body);
        if (!parsed.ok) return { status: 400, body: { message: 'Validation failed', errors: parsed.errors } };
        const recipe = state.recipes.find((r) => r.recipeId === parsed.data.recipe_id);
        if (!recipe) return { status: 404, body: { message: 'Recipe not found' } };
        const id = `PROD-${Date.now()}`;
        state.productions.push({ id, ...parsed.data, shopId });
        state.events.push({ type: 'production_started', id });
        return {
          status: 201,
          body: { success: true, productionId: id, message: 'Production started' },
        };
      }

      if (key === 'POST /kitchen/pre-prep' || key === 'POST /production/pre-prep') {
        if (!['KITCHEN', 'MANAGER', 'ADMIN'].includes(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        const parsed = parsePrePrep(body);
        if (!parsed.ok) return { status: 400, body: { message: 'Validation failed', errors: parsed.errors } };
        const raw = state.stock.get(parsed.data.raw_item_id);
        if (!raw || raw.qty < parsed.data.original_qty) {
          return { status: 400, body: { message: 'Insufficient raw stock' } };
        }
        const lost = parsed.data.original_qty - parsed.data.yielded_qty;
        raw.qty -= parsed.data.original_qty;
        const prep = state.stock.get(parsed.data.prepped_item_id) || { qty: 0, unit_cost: 0 };
        const preppedUnitCost =
          parsed.data.yielded_qty > 0
            ? (parsed.data.original_qty * raw.unit_cost) / parsed.data.yielded_qty
            : 0;
        prep.qty += parsed.data.yielded_qty;
        prep.unit_cost = preppedUnitCost;
        state.stock.set(parsed.data.prepped_item_id, prep);
        state.events.push({ type: 'pre_prep_completed', lost });
        return {
          status: 201,
          body: {
            success: true,
            batchId: `PREP-${Date.now()}`,
            original_qty: parsed.data.original_qty,
            yielded_qty: parsed.data.yielded_qty,
            lost_qty: lost,
            loss_pct: Math.round((lost / parsed.data.original_qty) * 1000) / 10,
            prepped_unit_cost: Math.round(preppedUnitCost * 100) / 100,
          },
        };
      }

      if (key === 'GET /kitchen/closing-stock') {
        const items = [...state.stock.entries()].map(([itemId, s]) => ({
          itemId,
          itemName: itemId,
          unit: 'kg',
          systemQty: s.qty,
          countedQty: null,
        }));
        return { status: 200, body: items };
      }

      if (key === 'POST /kitchen/closing-stock') {
        if (!canSubmitClosingStock(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        state.events.push({ type: 'closing_stock_counted', body });
        return { status: 201, body: { success: true, message: 'Closing stock saved' } };
      }

      if (key === 'POST /waste/record') {
        const mapped =
          body?.module_source === 'manual'
            ? { ...body, module_source: 'kitchen' }
            : body;
        const parsed = parseWaste(mapped);
        if (!parsed.ok) return { status: 400, body: { message: 'Validation failed', errors: parsed.errors } };
        state.events.push({ type: 'waste_recorded', body: parsed.data });
        return { status: 201, body: { success: true, wasteId: `w-${state.events.length}` } };
      }

      if (key === 'GET /approvals/pending') {
        if (!['MANAGER', 'ADMIN'].includes(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        return { status: 200, body: state.approvals };
      }

      if (key.startsWith('POST /approvals/') && key.endsWith('/approve')) {
        if (!['MANAGER', 'ADMIN'].includes(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        const id = pathParam(path, 1);
        state.approvals = state.approvals.filter((a) => a.id !== id);
        state.events.push({ type: 'approval_granted', id });
        return { status: 200, body: { success: true, approvalId: id } };
      }

      if (key.startsWith('POST /approvals/') && key.endsWith('/reject')) {
        if (!['MANAGER', 'ADMIN'].includes(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        const id = pathParam(path, 1);
        state.approvals = state.approvals.filter((a) => a.id !== id);
        state.events.push({ type: 'approval_rejected', id, reason: body?.reason });
        return { status: 200, body: { success: true, approvalId: id } };
      }

      if (key === 'GET /dashboard/summary') {
        if (!['MANAGER', 'ADMIN'].includes(role)) {
          return { status: 403, body: { message: 'Forbidden' } };
        }
        return {
          status: 200,
          body: {
            shopId: shopId || '1',
            shopName: 'Main',
            todayRevenue: 15000,
            todayOrders: 42,
            openApprovals: state.approvals.length,
            lowStockCount: 2,
            nearExpiryCount: 1,
          },
        };
      }

      return { status: 404, body: { message: `No route ${key}` } };
    },
  };
}

function pathParam(path, index) {
  return path.split('/').filter(Boolean)[index];
}

// ─── Mobile client simulation ──────────────────────────────────────────────

function mobileStartProduction(api, recipe, planned, role = 'KITCHEN') {
  const body = {
    recipe_id: recipe.recipeId,
    item_id: recipe.item_id || recipe.itemId,
    item_name: recipe.item_name || recipe.name,
    planned_quantity: planned,
  };
  return api.handle('POST', '/production/start', { body, role, shopId: '1' });
}

function mobilePrePrep(api, payload, role = 'KITCHEN') {
  return api.handle('POST', '/kitchen/pre-prep', { body: payload, role, shopId: '1' });
}

function mobileRecordWaste(api, payload, role = 'KITCHEN') {
  // mobile maps manual → kitchen before send
  const body = {
    ...payload,
    module_source:
      payload.module_source === 'manual' ? 'kitchen' : payload.module_source,
  };
  return api.handle('POST', '/waste/record', { body, role });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('integration: production start flow', () => {
  let api;
  beforeEach(() => {
    api = createMockApi();
  });

  it('mobile loads recipes then starts batch with recipe_id', () => {
    const list = api.handle('GET', '/recipe', { role: 'KITCHEN' });
    assert.equal(list.status, 200);
    const recipes = asArray(list.body);
    assert.ok(recipes.length >= 1);

    const pick = recipes[0];
    const res = mobileStartProduction(api, pick, 12, 'KITCHEN');
    assert.equal(res.status, 201);
    assert.ok(res.body.productionId);
    assert.equal(api.state.productions[0].recipe_id, 'rec-buns');
    assert.equal(api.state.productions[0].item_id, 'BUNS');
  });

  it('rejects start without recipe_id end-to-end', () => {
    const res = api.handle('POST', '/production/start', {
      role: 'KITCHEN',
      body: { item_id: 'BUNS', item_name: 'Buns', planned_quantity: 5 },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.includes('recipe_id'));
  });
});

describe('integration: pre-prep stock effects', () => {
  let api;
  beforeEach(() => {
    api = createMockApi();
  });

  it('deducts raw, adds prepped, returns loss metrics', () => {
    const before = api.state.stock.get('CHICKEN-RAW').qty;
    const res = mobilePrePrep(api, {
      raw_item_id: 'CHICKEN-RAW',
      prepped_item_id: 'CHICKEN-PREP',
      original_qty: 10,
      yielded_qty: 8,
      loss_reason: 'trim',
      unit: 'kg',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.lost_qty, 2);
    assert.equal(res.body.loss_pct, 20);
    assert.equal(api.state.stock.get('CHICKEN-RAW').qty, before - 10);
    assert.equal(api.state.stock.get('CHICKEN-PREP').qty, 8);
    assert.ok(res.body.prepped_unit_cost > 0);
  });

  it('fails validation when loss_reason missing', () => {
    const res = mobilePrePrep(api, {
      raw_item_id: 'CHICKEN-RAW',
      prepped_item_id: 'CHICKEN-PREP',
      original_qty: 10,
      yielded_qty: 8,
    });
    assert.equal(res.status, 400);
  });

  it('fails when insufficient stock', () => {
    const res = mobilePrePrep(api, {
      raw_item_id: 'CHICKEN-RAW',
      prepped_item_id: 'CHICKEN-PREP',
      original_qty: 999,
      yielded_qty: 900,
      loss_reason: 'trim',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Insufficient/);
  });
});

describe('integration: closing stock roles', () => {
  let api;
  beforeEach(() => {
    api = createMockApi();
  });

  it('KITCHEN can GET but not POST', () => {
    const get = api.handle('GET', '/kitchen/closing-stock', { role: 'KITCHEN' });
    assert.equal(get.status, 200);
    assert.ok(asArray(get.body).length > 0);

    const post = api.handle('POST', '/kitchen/closing-stock', {
      role: 'KITCHEN',
      body: { entries: [{ itemId: 'BUNS', countedQty: 10 }] },
    });
    assert.equal(post.status, 403);
  });

  it('MANAGER can submit closing stock', () => {
    const post = api.handle('POST', '/kitchen/closing-stock', {
      role: 'MANAGER',
      body: { entries: [{ itemId: 'BUNS', countedQty: 10 }] },
    });
    assert.equal(post.status, 201);
    assert.ok(api.state.events.some((e) => e.type === 'closing_stock_counted'));
  });
});

describe('integration: waste record path', () => {
  let api;
  beforeEach(() => {
    api = createMockApi();
  });

  it('maps mobile manual → kitchen and records', () => {
    const res = mobileRecordWaste(api, {
      module_source: 'manual',
      item_id: 'OIL',
      item_name: 'Oil',
      quantity_wasted: 1,
      waste_reason: 'spoiled on shelf',
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.wasteId);
    const ev = api.state.events.find((e) => e.type === 'waste_recorded');
    assert.equal(ev.body.module_source, 'kitchen');
  });
});

describe('integration: approvals + dashboard', () => {
  let api;
  beforeEach(() => {
    api = createMockApi();
  });

  it('manager lists approvals, approves, dashboard openApprovals drops', () => {
    const pending = api.handle('GET', '/approvals/pending', { role: 'MANAGER' });
    assert.equal(pending.status, 200);
    const items = asArray(pending.body);
    assert.equal(items.length, 1);

    const summaryBefore = api.handle('GET', '/dashboard/summary', {
      role: 'MANAGER',
      shopId: '1',
    });
    assert.equal(summaryBefore.body.openApprovals, 1);

    const id = items[0].id;
    const appr = api.handle('POST', `/approvals/${id}/approve`, {
      role: 'MANAGER',
      body: {},
    });
    assert.equal(appr.status, 200);

    const pendingAfter = api.handle('GET', '/approvals/pending', {
      role: 'MANAGER',
    });
    assert.equal(asArray(pendingAfter.body).length, 0);

    const summaryAfter = api.handle('GET', '/dashboard/summary', {
      role: 'MANAGER',
    });
    assert.equal(summaryAfter.body.openApprovals, 0);
  });

  it('KITCHEN cannot list approvals', () => {
    const res = api.handle('GET', '/approvals/pending', { role: 'KITCHEN' });
    assert.equal(res.status, 403);
  });
});
