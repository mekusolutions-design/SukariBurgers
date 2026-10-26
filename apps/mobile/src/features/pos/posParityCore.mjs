
export function normalizeMenuLine(raw) {
  const optsRaw = raw.options || raw.optionItems || raw.option_items || [];
  const options = (Array.isArray(optsRaw) ? optsRaw : []).map((o) => {
    const r = o ?? {};
    return {
      finishedGoodId: String(r.finishedGoodId ?? r.finished_good_id ?? r.itemId ?? r.item_id ?? ''),
      finishedGoodName: String(r.finishedGoodName ?? r.finished_good_name ?? r.name ?? ''),
      availableStock: Number(r.availableStock ?? r.available_stock ?? r.stock ?? 0),
    };
  }).filter((o) => o.finishedGoodId);
  return {
    componentKey: String(raw.componentKey ?? raw.component_key ?? 'main'),
    componentType: String(raw.componentType ?? raw.component_type ?? 'FIXED').toUpperCase(),
    finishedGoodId: raw.finishedGoodId ?? raw.finished_good_id ?? null,
    finishedGoodName: raw.finishedGoodName ?? raw.finished_good_name ?? null,
    finishedGoodCategoryName: raw.finishedGoodCategoryName ?? raw.finished_good_category_name ?? null,
    quantityRequired: Number(raw.quantityRequired ?? raw.quantity_required ?? 1),
    options,
  };
}
export function normalizeMenuLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeMenuLine(x ?? {}));
}
export function mergeAvailabilityOntoMenus(menus, availability) {
  if (!availability?.length) return menus;
  const byId = new Map();
  for (const a of availability) {
    const id = String(a.menuItemId ?? a.menuId ?? a.menu_id ?? '').trim();
    if (id) byId.set(id, a);
  }
  return menus.map((m) => {
    const id = String(m.menuId ?? m.menu_id ?? m.id ?? '').trim();
    const hit = byId.get(id);
    if (!hit) return m;
    const maxPortions = Math.max(0, Math.floor(Number(hit.maxPortions ?? hit.availableQuantity ?? m.maxPortions ?? 0)));
    return { ...m, maxPortions, availableQuantity: maxPortions, isAvailable: hit.isAvailable !== false && maxPortions > 0 };
  });
}
export function isMenuSellable(m) {
  const maxP = Math.max(0, Math.floor(Number(m.maxPortions ?? m.availableQuantity ?? 0)));
  return m.isAvailable !== false && maxP > 0;
}
export function requiredUnits(component, soldQty) {
  return Math.max(0.0001, Number(component.quantityRequired ?? 1)) * Math.max(1, soldQty);
}
export function choiceLinesNeedingPick(lines) {
  if (!lines?.length) return [];
  return lines.filter((line) => {
    const type = String(line.componentType || '').toUpperCase();
    if (type !== 'CHOICE' && type !== 'MULTI_CHOICE') return false;
    return (line.options ?? []).length > 1;
  });
}
export function buildLineSelections(lines, soldQty, preferredByComponent) {
  if (!lines?.length) return [];
  const out = [];
  for (const line of lines) {
    const type = String(line.componentType || 'FIXED').toUpperCase();
    const need = requiredUnits(line, soldQty);
    const key = String(line.componentKey || 'main');
    if (type === 'FIXED' || type === 'INVENTORY') {
      const fg = (line.finishedGoodId || '').trim() || line.options?.[0]?.finishedGoodId || '';
      if (!fg) return null;
      out.push({ component_key: key, finished_good_id: fg, finished_good_name: line.finishedGoodName || line.options?.[0]?.finishedGoodName || fg, quantity: need });
      continue;
    }
    const opts = line.options ?? [];
    const preferred = preferredByComponent?.[key];
    const pick = (preferred ? opts.find((o) => o.finishedGoodId === preferred) : undefined) ?? (opts.length === 1 ? opts[0] : undefined);
    if (!pick?.finishedGoodId) {
      if (opts.length === 0 && line.finishedGoodId) {
        out.push({ component_key: key, finished_good_id: line.finishedGoodId, finished_good_name: line.finishedGoodName || line.finishedGoodId, quantity: need });
        continue;
      }
      return null;
    }
    out.push({ component_key: key, finished_good_id: pick.finishedGoodId, finished_good_name: pick.finishedGoodName || pick.finishedGoodId, quantity: need });
  }
  return out;
}
export function validateLineSelections(menuName, lines, selections, soldQty) {
  if (!lines?.length) return null;
  for (const component of lines) {
    const type = String(component.componentType || 'FIXED').toUpperCase();
    if (type === 'FIXED' || type === 'INVENTORY') {
      const fg = (component.finishedGoodId || '').trim() || component.options?.[0]?.finishedGoodId;
      if (!fg) return `${menuName}: fixed component "${component.componentKey}" is not linked to inventory`;
      continue;
    }
    const need = requiredUnits(component, soldQty);
    const got = (selections ?? []).filter((s) => s.component_key === component.componentKey).reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    if (got + 1e-9 < need) {
      return `${menuName}: ${component.finishedGoodCategoryName || component.componentKey} needs ${need}, got ${got}`;
    }
  }
  return null;
}
export function normalizeBootstrapMenus(boot) {
  const raw = Array.isArray(boot.menus) ? boot.menus : Array.isArray(boot.items) ? boot.items : [];
  return mergeAvailabilityOntoMenus(raw.filter((m) => m.isVisible !== false), boot.availability).map((m) => ({
    ...m,
    lines: normalizeMenuLines(m.lines),
  }));
}
