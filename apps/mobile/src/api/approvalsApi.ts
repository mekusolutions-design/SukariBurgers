// apps/mobile/src/api/approvalsApi.ts
import apiClient from './apiClient';
import { API_ENDPOINTS } from './endpoints';

export type PendingApproval = {
  id: string;
  type: string;
  summary: string;
  amount: number;
  requestedBy: string;
  requestedAt: string;
  itemId?: string | null;
};

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (Array.isArray(r.items)) return r.items;
    if (Array.isArray(r.data)) return r.data;
  }
  return [];
}

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function mapApproval(row: Record<string, unknown>): PendingApproval {
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

export async function fetchPendingApprovals(
  shopId: string = '1',
): Promise<PendingApproval[]> {
  const { data } = await apiClient.get(API_ENDPOINTS.APPROVALS_PENDING, {
    params: { shopId },
  });
  return asArray(data)
    .map((row) => mapApproval((row ?? {}) as Record<string, unknown>))
    .filter((a) => a.id);
}

export async function approveRequest(
  approvalId: string,
  note?: string,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.APPROVALS_APPROVE(approvalId), {
    note: note ?? undefined,
  });
}

export async function rejectRequest(
  approvalId: string,
  reason: string,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.APPROVALS_REJECT(approvalId), {
    reason,
  });
}
