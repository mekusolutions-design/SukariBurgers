export function asString(v, fallback = '') {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function asNumber(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
}

export function normalizeRecipe(row) {
  const recipeId = asString(row.recipeId ?? row.recipe_id ?? row.id ?? row.recipe_code);
  const itemId = asString(row.itemId ?? row.item_id ?? row.menuItemId);
  const name = asString(row.name ?? row.item_name ?? row.itemName ?? itemId ?? recipeId);
  if (!recipeId) return null;
  return {
    recipeId,
    itemId: itemId ?? recipeId,
    name: name || recipeId,
    unit: asString(row.unit ?? row.yield_unit ?? row.yieldUnit, 'pcs'),
    standardYield: asNumber(row.standardYield ?? row.standard_yield ?? row.yield_quantity, 1),
    maxPortions:
      row.maxPortionsFromStock != null || row.max_portions != null
        ? asNumber(row.maxPortionsFromStock ?? row.max_portions)
        : null,
    isAvailable:
      row.isAvailable != null || row.is_available != null
        ? Boolean(row.isAvailable ?? row.is_available)
        : undefined,
  };
}

export function filterRecipes(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.itemId.toLowerCase().includes(q) ||
      r.recipeId.toLowerCase().includes(q),
  );
}

export function mapApproval(row) {
  return {
    id: asString(row.id),
    type: asString(row.type, 'other'),
    summary: asString(row.summary, 'Pending request'),
    amount: asNumber(row.amount),
    requestedBy: asString(row.requestedBy ?? row.requested_by, 'Unknown'),
    requestedAt: asString(row.requestedAt ?? row.requested_at ?? row.createdAt),
    itemId:
      row.itemId != null || row.item_id != null
        ? asString(row.itemId ?? row.item_id)
        : null,
  };
}

export function validatePrePrep(input) {
  if (!input.raw_item_id.trim() || !input.prepped_item_id.trim()) {
    return 'Enter both raw item ID and prepped item ID.';
  }
  if (!(input.original_qty > 0) || !(input.yielded_qty > 0)) {
    return 'Original and yielded must be positive.';
  }
  if (input.yielded_qty > input.original_qty) {
    return 'Yielded cannot exceed original quantity.';
  }
  const lost = input.original_qty - input.yielded_qty;
  if (lost > 0 && !(input.loss_reason && input.loss_reason.trim())) {
    return 'Loss reason is required when weight is lost.';
  }
  return null;
}

export function computeLoss(original, yielded) {
  if (!(original > 0) || !(yielded > 0) || yielded > original) {
    return { lost: null, lossPct: null };
  }
  const lost = Math.round((original - yielded) * 1000) / 1000;
  const lossPct = Math.round((lost / original) * 1000) / 10;
  return { lost, lossPct };
}

export function validateStartProduction(input) {
  if (!input.recipe_id || !String(input.recipe_id).trim()) {
    return 'Recipe ID is required';
  }
  if (!input.item_id || !String(input.item_id).trim()) {
    return 'Item ID is required';
  }
  if (!input.item_name || !String(input.item_name).trim()) {
    return 'Item name is required';
  }
  if (input.planned_quantity == null || !(Number(input.planned_quantity) > 0)) {
    return 'Planned quantity must be positive';
  }
  return null;
}

export function canSubmitClosingStock(role) {
  const r = (role || '').toUpperCase();
  return r === 'MANAGER' || r === 'ADMIN';
}

export function buildStartProductionBody(input) {
  return {
    recipe_id: input.recipe_id.trim(),
    item_id: input.item_id.trim(),
    item_name: input.item_name.trim(),
    planned_quantity: input.planned_quantity,
    notes: input.notes?.trim() || undefined,
  };
}

export function wasteRecordPath() {
  return '/waste/record';
}
