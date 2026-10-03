import { toMoneyNumber } from '../../common/utils/money.util';
// apps/api/src/modules/inventory/inventory.service.ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  InventoryGateway,
  type StockUpdatePayload,
  type LowStockAlertPayload,
} from './inventory.gateway';

/** Fallback only when Item.reorder_point is unset; prefer seeded 20%-of-receive ROP. */
const DEFAULT_REORDER_POINT = 0;
const DEFAULT_PAGE_SIZE = 20;

/** SKUs produced by kitchen — not shown on main Inventory page */
const FINISHED_CATEGORY_RE = /finished|production|fg\b/i;

export interface StockListOptions {
  shopId?: string;
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  status?: string;
  lowStockOnly?: boolean;
  includeWrittenOff?: boolean;
  /** Include finished-goods SKUs (default false on main inventory) */
  includeFinished?: boolean;
}

export interface StockRow {
  id: string;
  item_id: string;
  name: string;
  unit: string;
  category: string;
  reorder_point: number;
  min_stock: number;
  available_stock: number;
  expired_stock: number;
  damaged_stock: number;
  total_value: number;
  /** Weighted average unit cost (WAC) from GRN stream */
  avg_unit_cost: number;
  last_receipt_unit_cost: number | null;
  days_to_expiry_min: number | null;
  last_received_at: Date | null;
  next_expiry_date: Date | null;
  shop_id: string;
  updated_at?: Date | string | null;
}

export interface PaginatedStock {
  items: StockRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface StockAlert {
  item_id: string;
  item_name: string;
  current_stock: number;
  threshold: number;
  shop_id: string;
  severity: 'low' | 'critical';
  total_value: number;
}

export interface InventorySummaryStats {
  shopId: string;
  totalItems: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowOrOutCount: number;
  expiredCount: number;
  nearExpiryCount: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly inventoryGateway?: InventoryGateway,
  ) {}

  private isFinishedCategory(category: string | null | undefined): boolean {
    return FINISHED_CATEGORY_RE.test(String(category ?? ''));
  }

  async getSummary(shopId: string = '1'): Promise<InventorySummaryStats> {
    const rows = await this.prisma.inventoryProjection.findMany({
      where: { shop_id: shopId },
      include: {
        item: {
          select: {
            name: true,
            unit: true,
            category: true,
            reorder_point: true,
            min_stock: true,
          },
        },
      },
    });

    let totalValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let expiredCount = 0;
    let nearExpiryCount = 0;
    let activeItems = 0;

    for (const row of rows) {
      const mapped = this.mapStockRow(row);
      if (this.isFinishedCategory(mapped.category)) continue;

      const writtenOffExpired = this.isWrittenOffExpired(mapped);
      if (!writtenOffExpired) {
        totalValue += mapped.total_value;
        activeItems += 1;
      }

      const available = mapped.available_stock;
      const reorder = mapped.reorder_point || DEFAULT_REORDER_POINT;
      const days = mapped.days_to_expiry_min;

      if (!writtenOffExpired) {
        if (available <= 0) outOfStockCount += 1;
        else if (available <= reorder) lowStockCount += 1;
      }

      if (this.isPastExpiry(mapped) && available > 0) expiredCount += 1;
      else if (days != null && days >= 0 && days <= 3 && available > 0) {
        nearExpiryCount += 1;
      }
    }

    return {
      shopId,
      totalItems: activeItems,
      totalValue: Math.round(totalValue * 100) / 100,
      lowStockCount,
      outOfStockCount,
      lowOrOutCount: lowStockCount + outOfStockCount,
      expiredCount,
      nearExpiryCount,
    };
  }

  async getAllStock(options: StockListOptions = {}): Promise<PaginatedStock> {
    const {
      shopId = '1',
      page = 1,
      limit = DEFAULT_PAGE_SIZE,
      search,
      category,
      status,
      lowStockOnly = false,
      includeWrittenOff = false,
      includeFinished = false,
    } = options;

    const take = Math.min(Math.max(limit || DEFAULT_PAGE_SIZE, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;

    const where: Prisma.InventoryProjectionWhereInput = {
      shop_id: shopId,
    };

    if (search?.trim()) {
      where.OR = [
        { item_id: { contains: search.trim(), mode: 'insensitive' } },
        { item: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const categoryNorm = category?.trim().toLowerCase() ?? '';
    const askingFinished =
      includeFinished ||
      FINISHED_CATEGORY_RE.test(categoryNorm) ||
      categoryNorm === 'finished goods';

    if (categoryNorm && categoryNorm !== 'all') {
      if (categoryNorm === 'general') {
        where.item = {
          OR: [
            { category: { equals: 'General', mode: 'insensitive' } },
            { category: null },
            { category: '' },
          ],
        };
      } else {
        where.item = {
          category: { equals: category!.trim(), mode: 'insensitive' },
        };
      }
    }

    const statusNorm = (status ?? '')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/\s+/g, '-');

    // low-stock is filtered in memory against per-item reorder_point (not a global 10)
    if (statusNorm === 'out-of-stock') {
      where.available_stock = { lte: 0 };
    }

    const isDefaultStatus = !statusNorm || statusNorm === 'all';
    const hideWrittenOffExpired =
      isDefaultStatus && !includeWrittenOff && !search?.trim();

    const needsInMemory =
      hideWrittenOffExpired ||
      !askingFinished ||
      (!!statusNorm &&
        statusNorm !== 'all' &&
        [
          'in-stock',
          'low-stock',
          'out-of-stock',
          'near-expiry',
          'expired',
        ].includes(statusNorm));

    const [rows, totalRaw] = await Promise.all([
      this.prisma.inventoryProjection.findMany({
        where,
        include: {
          item: {
            select: {
              name: true,
              unit: true,
              category: true,
              reorder_point: true,
              min_stock: true,
            },
          },
        },
        orderBy: { updated_at: 'desc' },
        take: needsInMemory ? 500 : take,
        skip: needsInMemory ? 0 : skip,
      }),
      this.prisma.inventoryProjection.count({ where }),
    ]);

    let items = rows.map((s) => this.mapStockRow(s));

    if (!askingFinished) {
      items = items.filter((row) => !this.isFinishedCategory(row.category));
    }

    if (hideWrittenOffExpired) {
      items = items.filter((row) => !this.isWrittenOffExpired(row));
    }

    if (needsInMemory && statusNorm && statusNorm !== 'all') {
      items = items.filter((row) => {
        const available = row.available_stock;
        const reorder = row.reorder_point || DEFAULT_REORDER_POINT;
        const days = row.days_to_expiry_min;
        switch (statusNorm) {
          case 'in-stock':
            return available > reorder && (days == null || days > 3);
          case 'low-stock':
            return available > 0 && available <= reorder;
          case 'out-of-stock':
            return available <= 0 && !this.isPastExpiry(row);
          case 'near-expiry':
            return available > 0 && days != null && days >= 0 && days <= 3;
          case 'expired':
            return this.isPastExpiry(row) && available > 0;
          default:
            return true;
        }
      });
    }

    const total = needsInMemory ? items.length : totalRaw;
    if (needsInMemory) {
      items = items.slice(skip, skip + take);
    }

    return {
      items,
      total,
      page: Math.max(page, 1),
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
    };
  }

  async getStockByItem(
    itemId: string,
    shopId: string = '1',
  ): Promise<StockRow | null> {
    const row = await this.prisma.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      include: {
        item: {
          select: {
            name: true,
            unit: true,
            category: true,
            reorder_point: true,
            min_stock: true,
          },
        },
      },
    });
    return row ? this.mapStockRow(row) : null;
  }

  async getAlerts(shopId: string = '1'): Promise<StockAlert[]> {
    const rows = await this.prisma.inventoryProjection.findMany({
      where: { shop_id: shopId },
      include: {
        item: {
          select: {
            name: true,
            unit: true,
            category: true,
            reorder_point: true,
            min_stock: true,
          },
        },
      },
      orderBy: { available_stock: 'asc' },
      take: 500,
    });

    return rows
      .map((s) => {
        const mapped = this.mapStockRow(s);
        const stock = mapped.available_stock;
        const threshold = mapped.reorder_point || DEFAULT_REORDER_POINT;
        return { mapped, stock, threshold };
      })
      .filter(
        ({ mapped, stock, threshold }) =>
          !this.isFinishedCategory(mapped.category) &&
          stock <= threshold &&
          !this.isWrittenOffExpired(mapped),
      )
      .map(({ mapped, stock, threshold }) => ({
        item_id: mapped.item_id,
        item_name: mapped.name,
        current_stock: stock,
        threshold,
        shop_id: mapped.shop_id,
        severity:
          stock <= Math.max(1, threshold * 0.3)
            ? ('critical' as const)
            : ('low' as const),
        total_value: mapped.total_value,
      }));
  }

  async getLowStockCandidates(shopId: string = '1') {
    const rows = await this.prisma.inventoryProjection.findMany({
      where: { shop_id: shopId },
      include: {
        item: {
          select: {
            name: true,
            unit: true,
            category: true,
            reorder_point: true,
            min_stock: true,
          },
        },
      },
      orderBy: { available_stock: 'asc' },
      take: 200,
    });

    return rows
      .map((s) => this.mapStockRow(s))
      .filter((m) => {
        if (this.isFinishedCategory(m.category)) return false;
        if (this.isWrittenOffExpired(m)) return false;
        const reorder = m.reorder_point || DEFAULT_REORDER_POINT;
        return m.available_stock <= reorder;
      })
      .map((m) => ({
        item_id: m.item_id,
        item_name: m.name,
        unit: m.unit,
        available_stock: m.available_stock,
        reorder_point: m.reorder_point || DEFAULT_REORDER_POINT,
        suggested_qty: Math.max(
          0,
          (m.reorder_point || DEFAULT_REORDER_POINT) * 2 - m.available_stock,
        ),
        total_value: m.total_value,
        shop_id: m.shop_id,
      }));
  }

  async updateStock(
    itemId: string,
    change: number,
    itemName?: string,
    shopId: string = '1',
  ): Promise<StockRow> {
    const updated = await this.prisma.inventoryProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        available_stock: { increment: change },
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        available_stock: Math.max(0, change),
        total_value: 0,
        expired_stock: 0,
        damaged_stock: 0,
      },
      include: {
        item: {
          select: {
            name: true,
            unit: true,
            category: true,
            reorder_point: true,
            min_stock: true,
          },
        },
      },
    });

    const mapped = this.mapStockRow(updated);
    this.emitStock(mapped, itemName);
    return mapped;
  }

  notifyStockChanged(payload: {
    shop_id: string;
    item_id: string;
    available_stock: number;
    total_value?: number;
    item_name?: string;
    expired_stock?: number;
    damaged_stock?: number;
    days_to_expiry_min?: number | null;
    next_expiry_date?: Date | null;
  }): void {
    this.emitStock(
      {
        id: payload.item_id,
        item_id: payload.item_id,
        name: payload.item_name ?? payload.item_id,
        unit: 'units',
        category: 'General',
        reorder_point: DEFAULT_REORDER_POINT,
        min_stock: 0,
        available_stock: payload.available_stock,
        expired_stock: payload.expired_stock ?? 0,
        damaged_stock: payload.damaged_stock ?? 0,
        total_value: payload.total_value ?? 0,
        avg_unit_cost: 0,
        last_receipt_unit_cost: null,
        days_to_expiry_min: this.computeDaysToExpiry(
          payload.next_expiry_date ?? null,
        ),
        last_received_at: null,
        next_expiry_date: payload.next_expiry_date ?? null,
        shop_id: payload.shop_id,
      },
      payload.item_name,
    );
  }

  private isPastExpiry(row: StockRow): boolean {
    return row.days_to_expiry_min != null && row.days_to_expiry_min < 0;
  }

  private isWrittenOffExpired(row: StockRow): boolean {
    return row.available_stock <= 0 && this.isPastExpiry(row);
  }

  private computeDaysToExpiry(
    nextExpiryDate: Date | string | null | undefined,
  ): number | null {
    if (!nextExpiryDate) return null;
    const end = new Date(nextExpiryDate);
    if (Number.isNaN(end.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.round(
      (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  private mapStockRow(s: {
    item_id: string;
    shop_id: string;
    available_stock: number | null;
    expired_stock?: number | null;
    damaged_stock?: number | null;
    total_value?: number | null | { toNumber(): number };
    avg_unit_cost?: number | null | { toNumber(): number };
    last_receipt_unit_cost?: number | null | { toNumber(): number };
    days_to_expiry_min?: number | null;
    last_received_at?: Date | null;
    next_expiry_date?: Date | null;
    updated_at?: Date | null;
    item?: {
      name?: string | null;
      unit?: string | null;
      category?: string | null;
      reorder_point?: number | null;
      min_stock?: number | null;
    } | null;
  }): StockRow {
    // Per-item fixed ROP (seeded ~20% of approved receive). 0 = unset, not a global 10.
    const reorder =
      s.item?.reorder_point != null && Number.isFinite(Number(s.item.reorder_point))
        ? Number(s.item.reorder_point)
        : DEFAULT_REORDER_POINT;
    const days = this.computeDaysToExpiry(s.next_expiry_date);

    return {
      id: s.item_id,
      item_id: s.item_id,
      name: s.item?.name ?? s.item_id,
      unit: s.item?.unit ?? 'units',
      category: s.item?.category?.trim() || 'General',
      reorder_point: reorder,
      min_stock: Number(s.item?.min_stock ?? 0),
      available_stock: Number(s.available_stock ?? 0),
      expired_stock: Number(s.expired_stock ?? 0),
      damaged_stock: Number(s.damaged_stock ?? 0),
      total_value: Number(s.total_value ?? 0),
      avg_unit_cost: (() => {
        const raw = s.avg_unit_cost;
        const direct = Number(
          raw != null && typeof raw === 'object' && 'toNumber' in raw
            ? (raw as { toNumber(): number }).toNumber()
            : raw ?? 0,
        );
        if (Number.isFinite(direct) && direct > 0) {
          return Math.round(direct * 1e6) / 1e6;
        }
        const qty = Number(s.available_stock ?? 0);
        const tv = Number(s.total_value ?? 0);
        if (qty > 0 && tv > 0) return Math.round((tv / qty) * 1e6) / 1e6;
        return 0;
      })(),
      last_receipt_unit_cost: (() => {
        const v = s.last_receipt_unit_cost;
        if (v == null) return null;
        const n = Number(
          typeof v === 'object' && v && 'toNumber' in v
            ? (v as { toNumber(): number }).toNumber()
            : v,
        );
        return Number.isFinite(n) ? n : null;
      })(),
      days_to_expiry_min: days,
      last_received_at: s.last_received_at ?? null,
      next_expiry_date: s.next_expiry_date ?? null,
      shop_id: s.shop_id,
      updated_at: s.updated_at ?? s.last_received_at ?? null,
    };
  }

  private emitStock(row: StockRow, itemName?: string): void {
    if (!this.inventoryGateway) return;

    try {
      const name = itemName ?? row.name;
      const threshold = row.reorder_point || DEFAULT_REORDER_POINT;
      const days = this.computeDaysToExpiry(row.next_expiry_date);

      const updatePayload: StockUpdatePayload = {
        shop_id: row.shop_id,
        item_id: row.item_id,
        item_name: name,
        available_stock: row.available_stock,
        total_value: row.total_value,
        expired_stock: row.expired_stock,
        damaged_stock: row.damaged_stock,
        days_to_expiry_min: days,
        next_expiry_date: row.next_expiry_date,
      };
      this.inventoryGateway.broadcastStockUpdate(updatePayload);

      if (
        row.available_stock <= threshold &&
        !this.isWrittenOffExpired(row) &&
        !this.isFinishedCategory(row.category)
      ) {
        const alertPayload: LowStockAlertPayload = {
          shop_id: row.shop_id,
          item_id: row.item_id,
          item_name: name,
          current_stock: row.available_stock,
          total_value: row.total_value,
          threshold,
        };
        this.inventoryGateway.broadcastLowStockAlert(alertPayload);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to broadcast stock update: ${message}`);
    }
  }
}
