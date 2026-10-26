// apps/mobile/src/features/pos/posParityCore.ts
/**
 * Full web POS parity helpers (NewOrderPanel + selectionGuards).
 */

export type ComponentType =
  | 'FIXED'
  | 'CHOICE'
  | 'MULTI_CHOICE'
  | 'INVENTORY'
  | string;

export type MenuOption = {
  finishedGoodId: string;
  finishedGoodName?: string;
  availableStock?: number;
};

export type MenuComponentLine = {
  componentKey: string;
  componentType: ComponentType;
  finishedGoodId?: string | null;
  finishedGoodName?: string | null;
  finishedGoodCategoryName?: string | null;
  quantityRequired?: number;
  options?: MenuOption[];
  maxPortions?: number;
  availableStock?: number;
};

export type ComponentSelection = {
  component_key: string;
  finished_good_id: string;
  finished_good_name?: string;
  quantity: number;
};

export type AvailabilityHit = {
  menuItemId?: string;
  menu_id?: string;
  menuId?: string;
  maxPortions?: number;
  availableQuantity?: number;
  isAvailable?: boolean;
};

export type BootstrapMenu = {
  menuId?: string;
  menu_id?: string;
  id?: string;
  name?: string;
  maxPortions?: number;
  availableQuantity?: number;
  isAvailable?: boolean;
  isVisible?: boolean;
  lines?: unknown;
  [key: string]: unknown;
};

/** Normalize one component line from Nest/Go (snake or camel). */
export function normalizeMenuLine(raw: Record<string, unknown>): MenuComponentLine {
  const optsRaw =
    (raw.options as unknown[]) ||
    (raw.optionItems as unknown[]) ||
    (raw.option_items as unknown[]) ||
    [];
  const options: MenuOption[] = (Array.isArray(optsRaw) ? optsRaw : []).map(
    (o) => {
      const r = (o ?? {}) as Record<string, unknown>;
      return {
        finishedGoodId: String(
          r.finishedGoodId ?? r.finished_good_id ?? r.itemId ?? r.item_id ?? '',
        ),
        finishedGoodName: String(
          r.finishedGoodName ??
            r.finished_good_name ??
            r.name ??
            r.itemName ??
            '',
        ),
        availableStock: Number(
          r.availableStock ?? r.available_stock ?? r.stock ?? 0,
        ),
      };
    },
  ).filter((o) => o.finishedGoodId);

  return {
    componentKey: String(
      raw.componentKey ?? raw.component_key ?? raw.key ?? 'main',
    ),
    componentType: String(
      raw.componentType ?? raw.component_type ?? raw.type ?? 'FIXED',
    ).toUpperCase(),
    finishedGoodId:
      (raw.finishedGoodId as string | null | undefined) ??
      (raw.finished_good_id as string | null | undefined) ??
      null,
    finishedGoodName:
      (raw.finishedGoodName as string | null | undefined) ??
      (raw.finished_good_name as string | null | undefined) ??
      null,
    finishedGoodCategoryName:
      (raw.finishedGoodCategoryName as string | null | undefined) ??
      (raw.finished_good_category_name as string | null | undefined) ??
      null,
    quantityRequired: Number(raw.quantityRequired ?? raw.quantity_required ?? 1),
    options,
    maxPortions:
      raw.maxPortions != null
        ? Number(raw.maxPortions)
        : raw.max_portions != null
          ? Number(raw.max_portions)
          : undefined,
    availableStock:
      raw.availableStock != null
        ? Number(raw.availableStock)
        : raw.available_stock != null
          ? Number(raw.available_stock)
          : undefined,
  };
}

export function normalizeMenuLines(raw: unknown): MenuComponentLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeMenuLine((x ?? {}) as Record<string, unknown>));
}

export function mergeAvailabilityOntoMenus<T extends BootstrapMenu>(
  menus: T[],
  availability: AvailabilityHit[] | undefined | null,
): T[] {
  if (!availability?.length) return menus;
  const byId = new Map<string, AvailabilityHit>();
  for (const a of availability) {
    const id = String(a.menuItemId ?? a.menuId ?? a.menu_id ?? '').trim();
    if (id) byId.set(id, a);
  }
  return menus.map((m) => {
    const id = String(m.menuId ?? m.menu_id ?? m.id ?? '').trim();
    const hit = byId.get(id);
    if (!hit) return m;
    const maxPortions = Math.max(
      0,
      Math.floor(
        Number(hit.maxPortions ?? hit.availableQuantity ?? m.maxPortions ?? 0),
      ),
    );
    return {
      ...m,
      maxPortions,
      availableQuantity: maxPortions,
      isAvailable: hit.isAvailable !== false && maxPortions > 0,
    };
  });
}

export function isMenuSellable(m: {
  maxPortions?: number;
  availableQuantity?: number;
  isAvailable?: boolean;
}): boolean {
  const maxP = Math.max(
    0,
    Math.floor(Number(m.maxPortions ?? m.availableQuantity ?? 0)),
  );
  return m.isAvailable !== false && maxP > 0;
}

export function requiredUnits(
  component: MenuComponentLine,
  soldQty: number,
): number {
  return Math.max(0.0001, Number(component.quantityRequired ?? 1)) * Math.max(1, soldQty);
}

/** Components that need an explicit cashier pick (multi-option CHOICE). */
export function choiceLinesNeedingPick(
  lines: MenuComponentLine[] | undefined | null,
): MenuComponentLine[] {
  if (!lines?.length) return [];
  return lines.filter((line) => {
    const type = String(line.componentType || '').toUpperCase();
    if (type !== 'CHOICE' && type !== 'MULTI_CHOICE') return false;
    const opts = line.options ?? [];
    if (opts.length <= 1) return false;
    return true;
  });
}

/**
 * Build selections for soldQty.
 * FIXED / INVENTORY / single-option CHOICE → auto.
 * Multi CHOICE uses preferredByComponent or returns null if any missing.
 */
export function buildLineSelections(
  lines: MenuComponentLine[] | undefined | null,
  soldQty: number,
  preferredByComponent?: Record<string, string>,
): ComponentSelection[] | null {
  if (!lines?.length) return [];
  const out: ComponentSelection[] = [];

  for (const line of lines) {
    const type = String(line.componentType || 'FIXED').toUpperCase();
    const need = requiredUnits(line, soldQty);
    const key = String(line.componentKey || 'main');

    if (type === 'FIXED' || type === 'INVENTORY') {
      const fg =
        (line.finishedGoodId || '').trim() ||
        line.options?.[0]?.finishedGoodId ||
        '';
      if (!fg) return null;
      out.push({
        component_key: key,
        finished_good_id: fg,
        finished_good_name:
          line.finishedGoodName ||
          line.options?.[0]?.finishedGoodName ||
          fg,
        quantity: need,
      });
      continue;
    }

    // CHOICE / MULTI_CHOICE
    const opts = line.options ?? [];
    const preferred = preferredByComponent?.[key];
    const pick =
      (preferred
        ? opts.find((o) => o.finishedGoodId === preferred)
        : undefined) ?? (opts.length === 1 ? opts[0] : undefined);

    if (!pick?.finishedGoodId) {
      if (opts.length === 0 && line.finishedGoodId) {
        out.push({
          component_key: key,
          finished_good_id: line.finishedGoodId,
          finished_good_name: line.finishedGoodName || line.finishedGoodId,
          quantity: need,
        });
        continue;
      }
      return null;
    }
    out.push({
      component_key: key,
      finished_good_id: pick.finishedGoodId,
      finished_good_name: pick.finishedGoodName || pick.finishedGoodId,
      quantity: need,
    });
  }
  return out;
}

/** Web-style validation message or null if OK. */
export function validateLineSelections(
  menuName: string,
  lines: MenuComponentLine[] | undefined,
  selections: ComponentSelection[] | undefined,
  soldQty: number,
): string | null {
  if (!lines?.length) return null;
  for (const component of lines) {
    const type = String(component.componentType || 'FIXED').toUpperCase();
    if (type === 'FIXED' || type === 'INVENTORY') {
      const fg = (component.finishedGoodId || '').trim() || component.options?.[0]?.finishedGoodId;
      if (!fg) {
        return `${menuName}: fixed component "${component.componentKey}" is not linked to inventory`;
      }
      continue;
    }
    const need = requiredUnits(component, soldQty);
    const got = (selections ?? [])
      .filter((s) => s.component_key === component.componentKey)
      .reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    if (got + 1e-9 < need) {
      const label =
        component.finishedGoodCategoryName || component.componentKey;
      return `${menuName}: ${label} needs ${need}, got ${got}`;
    }
  }
  return null;
}

export function normalizeBootstrapMenus(boot: {
  menus?: BootstrapMenu[];
  items?: BootstrapMenu[];
  availability?: AvailabilityHit[];
}): BootstrapMenu[] {
  const raw = Array.isArray(boot.menus)
    ? boot.menus
    : Array.isArray(boot.items)
      ? boot.items
      : [];
  const visible = raw.filter((m) => m.isVisible !== false);
  return mergeAvailabilityOntoMenus(visible, boot.availability).map((m) => ({
    ...m,
    lines: normalizeMenuLines(m.lines),
  }));
}
