// apps/mobile/src/api/closingStockApi.ts
import apiClient from './apiClient';
import { API_ENDPOINTS } from './endpoints';

/** Mirrors web/backend: expected = usable batch on-hand (Inventory Available). */
export interface ClosingStockLine {
  itemId: string;
  name: string;
  unit: string;
  systemQty: number;
  countedQty: number | null;
  lastCountedAt?: string | null;
  lastCountedQty?: number | null;
  daysSinceLastCount?: number | null;
}

export interface ClosingStockSubmitLine {
  itemId: string;
  countedQty: number;
  reasonCode?: string;
  notes?: string;
}

export interface ClosingStockSubmitResult {
  success?: boolean;
  alreadySubmitted?: boolean;
  repaired?: boolean;
  message?: string;
  [key: string]: unknown;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.lines)) return obj.lines as T[];
  }
  return [];
}

export async function fetchClosingStock(
  shopId: string = '1',
): Promise<ClosingStockLine[]> {
  const res = await apiClient.get(API_ENDPOINTS.KITCHEN_CLOSING_STOCK, {
    params: { shopId },
  });
  const root = (res.data ?? {}) as Record<string, unknown>;
  const rows = asArray<Record<string, unknown>>(root.items ? root : res.data);
  return rows.map((raw) => {
    const systemQty = Number(
      raw.expected_quantity ??
        raw.expectedQuantity ??
        raw.system_qty ??
        raw.systemQty ??
        0,
    );
    const days =
      raw.days_since_last_count != null
        ? Number(raw.days_since_last_count)
        : raw.daysSinceLastCount != null
          ? Number(raw.daysSinceLastCount)
          : null;
    return {
      itemId: String(raw.itemId ?? raw.item_id ?? ''),
      name: String(raw.name ?? raw.item_name ?? raw.itemName ?? ''),
      unit: String(raw.unit ?? 'pcs'),
      systemQty: Number.isFinite(systemQty) ? systemQty : 0,
      countedQty:
        raw.countedQty != null
          ? Number(raw.countedQty)
          : raw.counted_qty != null
            ? Number(raw.counted_qty)
            : null,
      lastCountedAt: (raw.last_counted_at ??
        raw.lastCountedAt ??
        null) as string | null,
      lastCountedQty:
        raw.last_counted_qty != null
          ? Number(raw.last_counted_qty)
          : raw.lastCountedQty != null
            ? Number(raw.lastCountedQty)
            : null,
      daysSinceLastCount:
        days != null && Number.isFinite(days) ? days : null,
    };
  });
}

/**
 * Submit counts. counted_qty = 0 is valid (empty stock).
 * Only include lines the operator explicitly entered (including 0).
 */
export async function submitClosingStock(
  shopId: string,
  lines: ClosingStockSubmitLine[],
  opts?: { shiftLabel?: string; notes?: string },
): Promise<ClosingStockSubmitResult> {
  for (const l of lines) {
    if (!Number.isFinite(l.countedQty) || l.countedQty < 0) {
      throw new Error(
        `Invalid counted quantity for ${l.itemId}: must be 0 or greater`,
      );
    }
  }
  const res = await apiClient.post(
    API_ENDPOINTS.KITCHEN_CLOSING_STOCK,
    {
      shop_id: shopId,
      shift_label: opts?.shiftLabel,
      notes: opts?.notes,
      lines: lines.map((l) => ({
        item_id: l.itemId,
        counted_qty: l.countedQty,
        notes: l.notes,
        reason_code: l.reasonCode,
      })),
    },
    { timeout: 120_000 },
  );
  return (res.data ?? { success: true }) as ClosingStockSubmitResult;
}

export async function fetchDailyStockLedger(
  shopId: string = '1',
  date?: string,
): Promise<Record<string, unknown>> {
  const res = await apiClient.get(API_ENDPOINTS.KITCHEN_CLOSING_STOCK_LEDGER, {
    params: { shopId, date },
  });
  return (res.data ?? {}) as Record<string, unknown>;
}

export async function fetchClosingStockHistory(
  shopId: string = '1',
): Promise<Record<string, unknown>> {
  const res = await apiClient.get(API_ENDPOINTS.KITCHEN_CLOSING_STOCK_HISTORY, {
    params: { shopId },
  });
  return (res.data ?? {}) as Record<string, unknown>;
}
