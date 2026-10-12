// apps/mobile/src/api/dashboardApi.ts
import apiClient from './apiClient';
import { API_ENDPOINTS } from './endpoints';

export type ShopSummary = {
  shopId: string;
  shopName: string;
  todayRevenue: number;
  todayOrders: number;
  openApprovals: number;
  lowStockCount: number;
  nearExpiryCount: number;
};

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export async function fetchShopSummary(
  shopId: string = '1',
): Promise<ShopSummary> {
  const { data } = await apiClient.get(API_ENDPOINTS.DASHBOARD_SUMMARY, {
    params: { shopId },
  });
  const root = (data ?? {}) as Record<string, unknown>;
  return {
    shopId: asString(root.shopId ?? root.shop_id, shopId),
    shopName: asString(root.shopName ?? root.shop_name, 'Shop'),
    todayRevenue: asNumber(root.todayRevenue ?? root.today_revenue),
    todayOrders: asNumber(root.todayOrders ?? root.today_orders),
    openApprovals: asNumber(root.openApprovals ?? root.open_approvals),
    lowStockCount: asNumber(root.lowStockCount ?? root.low_stock_count),
    nearExpiryCount: asNumber(root.nearExpiryCount ?? root.near_expiry_count),
  };
}
