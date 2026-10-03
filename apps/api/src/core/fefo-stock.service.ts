// apps/api/src/core/fefo-stock.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ConsumedBatchSlice = {
  batchId: string;
  batchNumber: string;
  quantity: number;
  unitCost: number;
  expiryDate: Date | null;
};

export type ConsumeStockResult = {
  itemId: string;
  shopId: string;
  quantity: number;
  /** Always WAC-based unit cost for valuation */
  unitCostWac: number;
  value: number;
  slices: ConsumedBatchSlice[];
};

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function roundMoney(n: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * FEFO moves quantity; WAC prices quantity.
 * Never cost a consumption at the picked lot's unit_cost.
 */
@Injectable()
export class FefoStockService {
  private readonly logger = new Logger(FefoStockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * WAC after receiving qty at unitCost onto existing on-hand.
   * new_WAC = (qty_on_hand × old_WAC + qty_received × batch_unit_cost)
   *         / (qty_on_hand + qty_received)
   */
  computeNewWac(
    qtyOnHand: number,
    oldWac: number,
    qtyReceived: number,
    batchUnitCost: number,
  ): number {
    const onHand = Math.max(0, qtyOnHand);
    const received = Math.max(0, qtyReceived);
    if (onHand + received <= 0) return 0;
    const old = Math.max(0, oldWac);
    const batch = Math.max(0, batchUnitCost);
    return roundMoney((onHand * old + received * batch) / (onHand + received));
  }

  async getWac(shopId: string, itemId: string): Promise<number> {
    const row = await this.prisma.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId || '1', item_id: itemId },
      },
    });
    if (!row) return 0;
    let wac = asNumber(row.avg_unit_cost, 0);
    const stock = asNumber(row.available_stock, 0);
    const value = asNumber(row.total_value, 0);
    if (wac <= 0 && stock > 0 && value > 0) {
      wac = roundMoney(value / stock);
    }
    return wac;
  }

  /**
   * Create a physical lot from GRN / stock increase and update projection WAC + roll-ups.
   * Caller still owns inventoryProjection qty/value upsert; this owns the batch row + WAC fields.
   */
  async recordReceiveBatch(opts: {
    shopId: string;
    itemId: string;
    batchNumber: string;
    quantity: number;
    unitCost: number;
    expiryDate?: Date | null;
    supplierId?: string | null;
    eventId?: string | null;
    /** Stock qty BEFORE this receive (for WAC formula) */
    qtyOnHandBefore: number;
    /** WAC BEFORE this receive */
    oldWac: number;
  }): Promise<{ newWac: number; batchId: string }> {
    const qty = Math.max(0, opts.quantity);
    const unitCost = Math.max(0, opts.unitCost);
    if (qty <= 0) {
      return { newWac: opts.oldWac, batchId: '' };
    }

    const newWac = this.computeNewWac(
      opts.qtyOnHandBefore,
      opts.oldWac,
      qty,
      unitCost,
    );

    const batch = await this.prisma.inventoryBatch.create({
      data: {
        shop_id: opts.shopId || '1',
        item_id: opts.itemId,
        batch_number: opts.batchNumber || `AUTO-${Date.now()}`,
        qty_received: qty,
        qty_remaining: qty,
        unit_cost: new Prisma.Decimal(unitCost),
        expiry_date: opts.expiryDate ?? null,
        supplier_id: opts.supplierId ?? null,
        event_id: opts.eventId ?? null,
        received_at: new Date(),
      },
    });

    await this.prisma.inventoryProjection.updateMany({
      where: {
        shop_id: opts.shopId || '1',
        item_id: opts.itemId,
      },
      data: {
        avg_unit_cost: new Prisma.Decimal(newWac),
        last_receipt_unit_cost: new Prisma.Decimal(unitCost),
        ...(opts.expiryDate
          ? { next_expiry_date: opts.expiryDate }
          : {}),
      },
    });

    // Refresh nearest expiry across open lots
    await this.refreshNearestExpiry(opts.shopId || '1', opts.itemId);

    this.logger.debug(
      `Receive batch ${batch.batch_number} item=${opts.itemId} qty=${qty} unitCost=${unitCost} newWac=${newWac}`,
    );

    return { newWac, batchId: batch.id };
  }

  async refreshNearestExpiry(shopId: string, itemId: string): Promise<void> {
    const open = await this.prisma.inventoryBatch.findMany({
      where: {
        shop_id: shopId,
        item_id: itemId,
        qty_remaining: { gt: 0 },
        expiry_date: { not: null },
      },
      orderBy: { expiry_date: 'asc' },
      take: 1,
      select: { expiry_date: true },
    });
    const nearest = open[0]?.expiry_date ?? null;
    let days: number | null = null;
    if (nearest) {
      const ms = nearest.getTime() - Date.now();
      days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    }
    await this.prisma.inventoryProjection.updateMany({
      where: { shop_id: shopId, item_id: itemId },
      data: {
        next_expiry_date: nearest,
        days_to_expiry_min: days,
      },
    });
  }

  /**
   * Drain open lots nearest-expiry-first. Does not update InventoryProjection
   * (caller / projection engine still owns aggregate qty); returns slices + WAC value.
   */
  async consumeStock(
    shopId: string,
    itemId: string,
    qtyNeeded: number,
    options?: { allowPartial?: boolean },
  ): Promise<ConsumeStockResult> {
    const need = Math.max(0, qtyNeeded);
    const shop = shopId || '1';
    if (need <= 0) {
      return {
        itemId,
        shopId: shop,
        quantity: 0,
        unitCostWac: await this.getWac(shop, itemId),
        value: 0,
        slices: [],
      };
    }

    // Ensure at least one open lot exists (seed from projection if legacy stock)
    await this.ensureOpenLots(shop, itemId);

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        shop_id: shop,
        item_id: itemId,
        qty_remaining: { gt: 0 },
      },
      orderBy: [
        { expiry_date: 'asc' }, // nulls last in Postgres by default for ASC? 
        { received_at: 'asc' },
      ],
    });

    // Explicit nulls last for FEFO
    batches.sort((a, b) => {
      if (a.expiry_date && b.expiry_date) {
        return a.expiry_date.getTime() - b.expiry_date.getTime();
      }
      if (a.expiry_date && !b.expiry_date) return -1;
      if (!a.expiry_date && b.expiry_date) return 1;
      return a.received_at.getTime() - b.received_at.getTime();
    });

    let remaining = need;
    const slices: ConsumedBatchSlice[] = [];

    for (const batch of batches) {
      if (remaining <= 0) break;
      const avail = Math.max(0, Number(batch.qty_remaining));
      if (avail <= 0) continue;
      const take = Math.min(avail, remaining);
      await this.prisma.inventoryBatch.update({
        where: { id: batch.id },
        data: { qty_remaining: avail - take },
      });
      remaining -= take;
      slices.push({
        batchId: batch.id,
        batchNumber: batch.batch_number,
        quantity: take,
        unitCost: asNumber(batch.unit_cost, 0),
        expiryDate: batch.expiry_date,
      });
    }

    if (remaining > 0 && !options?.allowPartial) {
      throw new BadRequestException(
        `Insufficient stock for ${itemId}: short by ${roundMoney(remaining, 4)}`,
      );
    }

    const consumed = need - remaining;
    const unitCostWac = await this.getWac(shop, itemId);
    const value = roundMoney(consumed * unitCostWac, 4);

    await this.refreshNearestExpiry(shop, itemId);

    this.logger.debug(
      `FEFO consume ${itemId} qty=${consumed} slices=${slices.length} wac=${unitCostWac}`,
    );

    return {
      itemId,
      shopId: shop,
      quantity: consumed,
      unitCostWac,
      value,
      slices,
    };
  }

  /**
   * If projection has stock but no open lots, seed one synthetic lot so FEFO can run.
   */
  async ensureOpenLots(shopId: string, itemId: string): Promise<void> {
    const openCount = await this.prisma.inventoryBatch.count({
      where: {
        shop_id: shopId,
        item_id: itemId,
        qty_remaining: { gt: 0 },
      },
    });
    if (openCount > 0) return;

    const proj = await this.prisma.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });
    const stock = asNumber(proj?.available_stock, 0);
    if (stock <= 0) return;

    let unitCost = asNumber(proj?.avg_unit_cost, 0);
    if (unitCost <= 0 && stock > 0) {
      unitCost = asNumber(proj?.total_value, 0) / stock;
    }

    await this.prisma.inventoryBatch.create({
      data: {
        shop_id: shopId,
        item_id: itemId,
        batch_number: `SEED-${itemId.slice(0, 12)}`,
        qty_received: stock,
        qty_remaining: stock,
        unit_cost: new Prisma.Decimal(Math.max(0, unitCost)),
        expiry_date: proj?.next_expiry_date ?? null,
        received_at: proj?.last_received_at ?? new Date(),
      },
    });

    this.logger.log(
      `Seeded synthetic FEFO lot for ${itemId} qty=${stock} shop=${shopId}`,
    );
  }
}
