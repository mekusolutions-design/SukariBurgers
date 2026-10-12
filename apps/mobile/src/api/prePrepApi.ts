// apps/mobile/src/api/prePrepApi.ts
import apiClient from './apiClient';
import { API_ENDPOINTS } from './endpoints';

export type PrePrepPayload = {
  shop_id?: string;
  raw_item_id: string;
  prepped_item_id: string;
  prepped_item_name?: string;
  original_qty: number;
  yielded_qty: number;
  loss_reason?: string;
  note?: string;
  unit?: string;
  method?: string;
};

export type PrePrepResult = {
  batchId?: string;
  original_qty: number;
  yielded_qty: number;
  lost_qty: number;
  loss_pct: number;
  prepped_unit_cost?: number;
  message?: string;
};

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export async function submitPrePrep(
  shopId: string,
  input: PrePrepPayload,
): Promise<PrePrepResult> {
  const body = {
    shop_id: input.shop_id ?? shopId,
    raw_item_id: input.raw_item_id.trim(),
    prepped_item_id: input.prepped_item_id.trim(),
    prepped_item_name: input.prepped_item_name?.trim() || undefined,
    original_qty: input.original_qty,
    yielded_qty: input.yielded_qty,
    loss_reason: input.loss_reason?.trim() || undefined,
    note: input.note?.trim() || undefined,
    unit: input.unit?.trim() || 'kg',
    method: input.method?.trim() || undefined,
  };

  const { data } = await apiClient.post(
    API_ENDPOINTS.KITCHEN_PRE_PREP,
    body,
  );
  const root = (data ?? {}) as Record<string, unknown>;
  const original = asNumber(root.original_qty ?? body.original_qty);
  const yielded = asNumber(root.yielded_qty ?? body.yielded_qty);
  const lost = asNumber(
    root.lost_qty ?? root.lostQty ?? Math.max(0, original - yielded),
  );
  const lossPct = asNumber(
    root.loss_pct ?? root.lossPct ?? (original > 0 ? (lost / original) * 100 : 0),
  );

  return {
    batchId: root.batchId != null ? String(root.batchId) : root.batch_id != null ? String(root.batch_id) : undefined,
    original_qty: original,
    yielded_qty: yielded,
    lost_qty: lost,
    loss_pct: Math.round(lossPct * 10) / 10,
    prepped_unit_cost:
      root.prepped_unit_cost != null || root.preppedUnitCost != null
        ? asNumber(root.prepped_unit_cost ?? root.preppedUnitCost)
        : undefined,
    message: root.message != null ? String(root.message) : undefined,
  };
}
