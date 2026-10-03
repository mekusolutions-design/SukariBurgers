import { toMoneyNumber } from '../common/utils/money.util';
// apps/api/src/core/projection-engine.service.ts
import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeInventoryCategory } from '../common/constants/inventory-categories';
import { InventoryGateway } from '../modules/inventory/inventory.gateway';
import { FefoStockService } from './fefo-stock.service';

/** Unset ROP — never use a global 10 for all SKUs. */
const UNSET_REORDER_POINT = 0;
/** Legacy Prisma/app default; treat as "system default" so receive can replace it. */
const LEGACY_DEFAULT_REORDER_POINT = 10;
const REORDER_PCT_OF_RECEIVE = 0.2;
const REORDER_FLOOR = 0.001;
const DEFAULT_CATEGORY = 'General';
const FINISHED_GOODS_CATEGORY = 'Finished Goods';

interface BasePayload {
  item_id?: string;
  item_name?: string;
  quantity?: number | string;
  total_cost?: number | string;
  unit_cost?: number | string;
  units?: string;
  unit?: string;
  category?: string;
  reorder_point?: number | string;
  min_stock?: number | string;
  reason?: string;
  waste_reason?: string;
  expiry_date?: string | Date;
  quantity_approved?: number | string;
  actual_quantity_produced?: number | string;
  quantity_wasted?: number | string;
  quantity_rejected?: number | string;
  total_waste_value?: number | string;
  adjustment_quantity?: number | string;
  issued_qty?: number | string;
  approved_qty?: number | string;
  lost_weight?: number | string;
  variance_reason?: string;
  total_amount?: number | string;
  batch_number?: string;
  stock_deductions?: Array<{ item_id?: string; quantity?: number | string }>;
  items?: Array<{ item_id?: string; quantity?: number | string }>;
  inputs?: Array<Record<string, unknown>>;
  outputs?: Array<Record<string, unknown>>;
  lines?: Array<Record<string, unknown>>;
  batch_id?: string;
  shop_id?: string;
  [key: string]: unknown;
}

interface ProjectionEvent {
  id: string;
  event_type: string;
  shop_id?: string | null;
  payload?: Prisma.JsonValue | BasePayload | null;
  item_id?: string | null;
  quantity?: number | null;
  total_cost?: number | null | { toNumber(): number };
  unit_cost?: number | null | { toNumber(): number };
  waste_reason?: string | null;
  batch_number?: string | null;
  expiry_date?: Date | null;
  created_at?: Date | string | null;
}

interface InventoryRow {
  available_stock: number;
  total_value?: number | null | { toNumber(): number };
  days_to_expiry_min?: number | null;
  expired_stock?: number | null;
  damaged_stock?: number | null;
  next_expiry_date?: Date | null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  // Prisma Decimal / Decimal.js
  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber: () => number }).toNumber === 'function'
  ) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }
  // Prisma Decimal sometimes serializes as { s, e, d }
  if (value != null && typeof value === 'object' && 'toString' in value) {
    const n = Number(String(value));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toPayload(
  raw: Prisma.JsonValue | BasePayload | null | undefined,
): BasePayload {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as BasePayload;
  }
  return {};
}

function asLine(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function computeDaysToExpiry(
  expiry: Date | string | null | undefined,
): number | null {
  if (!expiry) return null;
  const end = new Date(expiry);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

@Injectable()
export class ProjectionEngineService {
  /** When set, all writes use this client (supports interactive transactions). */
  private activeDb: PrismaService | Prisma.TransactionClient;
  private readonly logger = new Logger(ProjectionEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fefoStock: FefoStockService,
    @Optional()
    @Inject(forwardRef(() => InventoryGateway))
    private readonly inventoryGateway?: InventoryGateway,
  ) {
    this.activeDb = this.prisma;
  }

  async updateProjections(
    event: ProjectionEvent,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prevDb = this.activeDb;
    this.activeDb = tx ?? this.prisma;
    try {
      await this.updateProjectionsInner(event);
    } finally {
      this.activeDb = prevDb;
    }
  }

  private async updateProjectionsInner(event: ProjectionEvent): Promise<void> {
    const shopId = event.shop_id || '1';
    const payload = toPayload(event.payload);

    try {
      switch (event.event_type) {
        case 'received':
        case 'finished_good_added':
          await this.handleStockIncrease(payload, shopId, event);
          break;

        case 'production_finished':
          await this.handleProductionFinished(payload, shopId, event);
          break;

        case 'waste':
        case 'waste_recorded':
        case 'WASTE_RECORDED':
          await this.handleWaste(payload, shopId, event);
          break;

        case 'batch_expired':
          await this.handleBatchExpired(payload, shopId, event);
          break;

        case 'finished_good_adjusted':
          await this.handleAdjustment(payload, shopId);
          break;

        case 'refill_issued':
          await this.handleRefillIssued(payload, shopId, event);
          break;

        case 'pos_sale':
        case 'order_sent_to_kitchen':
        case 'order_status_updated':
        case 'order_payment_updated':
          await this.handlePosSale(payload, shopId, event);
          break;

        case 'closing_stock_counted':
          // Alias stock_count_completed is list/query only — do not re-apply stock twice
          await this.handleClosingStockCount(payload, shopId);
          break;
        case 'stock_count_completed':
          break;

        default:
          this.logger.debug(`No projection handler for: ${event.event_type}`);
      }

      this.logger.debug(`Projection updated for event ${event.id}`);
    } catch (error: unknown) {
      this.logger.error(`Projection failed for event ${event.id}`, error);
      await this.logFailure(event.id, error);
    }
  }

  private async handleProductionFinished(
    payload: BasePayload,
    shopId: string,
    event: Pick<
      ProjectionEvent,
      | 'item_id'
      | 'quantity'
      | 'total_cost'
      | 'unit_cost'
      | 'expiry_date'
      | 'batch_number'
    >,
  ): Promise<void> {
    let inputs: Record<string, unknown>[] = [];

    if (Array.isArray(payload.inputs) && payload.inputs.length > 0) {
      inputs = payload.inputs.map((row) => asLine(row));
    } else if (
      Array.isArray(payload.stock_deductions) &&
      payload.stock_deductions.length > 0
    ) {
      inputs = payload.stock_deductions.map((d) => ({
        item_id: d?.item_id,
        actual_quantity: d?.quantity,
      }));
    }

    const outputs: Record<string, unknown>[] = Array.isArray(payload.outputs)
      ? payload.outputs.map((row) => asLine(row))
      : [];

    for (const line of inputs) {
      const itemId = asString(line['item_id'] ?? line['itemId']);
      const qty = Math.abs(
        asNumber(
          line['actual_quantity'] ??
            line['actualQuantity'] ??
            line['quantity'] ??
            line['standard_quantity'],
        ),
      );
      if (!itemId || qty <= 0) continue;

      await this.ensureItemExists(itemId, {
        item_id: itemId,
        item_name: asString(line['item_name'] ?? line['itemName']),
        unit: asString(line['unit']),
      });

      const unitCost = asNumber(line['unit_cost'] ?? line['unitCost']);
      const value = qty * unitCost;

      const existing = await this.activeDb.inventoryProjection.findUnique({
        where: {
          shop_id_item_id: { shop_id: shopId, item_id: itemId },
        },
      });

      const prev = Number(existing?.available_stock ?? 0);
      const nextStock = Math.max(0, prev - qty);
      const prevValue = Number(existing?.total_value ?? 0);
      const nextValue = Math.max(0, prevValue - (value > 0 ? value : 0));

      const row = await this.activeDb.inventoryProjection.upsert({
        where: {
          shop_id_item_id: { shop_id: shopId, item_id: itemId },
        },
        update: {
          available_stock: nextStock, // TODO: prefer conditional atomic update when concurrent load is high
          ...(value > 0 ? { total_value: nextValue } : {}),
        },
        create: {
          shop_id: shopId,
          item_id: itemId,
          available_stock: 0,
          total_value: 0,
          expired_stock: 0,
          damaged_stock: 0,
        },
      });

      this.logger.debug(
        `Production deduct ${itemId}: ${prev} → ${nextStock} (−${qty})`,
      );
      await this.emitStock(
        itemId,
        shopId,
        row,
        asString(line['item_name'] ?? line['itemName']),
      );
    }

    if (outputs.length > 0) {
      for (const line of outputs) {
        const itemId = asString(line['item_id'] ?? line['itemId']);
        let qty = asNumber(
          line['usable_quantity'] ??
            line['usableQuantity'] ??
            line['actual_quantity'] ??
            line['actualQuantity'] ??
            line['quantity'],
        );
        // Primary finished good: prefer payload usable_quantity (produced − waste)
        const primaryId = asString(payload.item_id ?? payload.itemId ?? event.item_id);
        if (primaryId && itemId === primaryId) {
          const usable = asNumber(
            payload.usable_quantity ?? payload.usableQuantity,
          );
          if (usable > 0) qty = usable;
        }
        if (!itemId || qty <= 0) continue;

        let unitCost = asNumber(line['unit_cost'] ?? line['unitCost']);
        // Fall back to production header unit cost (COG Phase 3)
        if (!(unitCost > 0)) {
          unitCost = asNumber(
            payload.unit_cost ?? payload.unitCost ?? event.unit_cost,
          );
        }
        let totalCost = unitCost > 0 ? qty * unitCost : 0;
        if (!(totalCost > 0)) {
          totalCost = asNumber(payload.total_cost ?? payload.totalCost);
          if (totalCost > 0 && qty > 0 && !(unitCost > 0)) {
            unitCost = totalCost / qty;
          }
        }

        // Pass 'Finished Goods' category for production outputs
        await this.handleStockIncrease(
          {
            item_id: itemId,
            item_name: asString(line['item_name'] ?? line['itemName']),
            quantity: qty,
            total_cost: totalCost,
            unit_cost: unitCost,
            unit: asString(line['unit']),
            category: FINISHED_GOODS_CATEGORY,
            expiry_date: payload.expiry_date,
            batch_number:
              asString(payload.batch_number) ?? event.batch_number ?? undefined,
          },
          shopId,
          {
            item_id: itemId,
            quantity: qty,
            total_cost: totalCost,
            unit_cost: unitCost > 0 ? unitCost : null,
            expiry_date: event.expiry_date,
          },
        );
      }
      return;
    }

    await this.handleStockIncrease(payload, shopId, event);
  }

  private async handleClosingStockCount(
    payload: BasePayload,
    shopId: string,
  ): Promise<void> {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (lines.length === 0) return;

    const resolvedShop = asString(payload.shop_id) || shopId;

    const applyLine = async (raw: unknown): Promise<void> => {
      const line = asLine(raw);
      const itemId = asString(line['item_id'] ?? line['itemId']);
      if (!itemId) return;

      const countedQty = asNumber(
        line['counted_qty'] ??
          line['counted_quantity'] ??
          line['countedQuantity'],
      );
      const unitCost = asNumber(line['unit_cost'] ?? line['unitCost']);
      const newValue = Math.max(0, countedQty) * (unitCost > 0 ? unitCost : 0);

      await this.ensureItemExists(itemId, {
        item_id: itemId,
        item_name: asString(line['item_name'] ?? line['itemName']),
        unit: asString(line['unit']),
        category: normalizeInventoryCategory(asString(line['category'])),
      });

      const row = await this.activeDb.inventoryProjection.upsert({
        where: {
          shop_id_item_id: { shop_id: resolvedShop, item_id: itemId },
        },
        update: {
          available_stock: Math.max(0, countedQty),
          ...(unitCost > 0 ? { total_value: newValue } : {}),
        },
        create: {
          shop_id: resolvedShop,
          item_id: itemId,
          available_stock: Math.max(0, countedQty),
          total_value: newValue,
          expired_stock: 0,
          damaged_stock: 0,
        },
      });

      // Fire-and-forget WS notify — do not block closing stock response
      void this.emitStock(
        itemId,
        resolvedShop,
        row,
        asString(line['item_name'] ?? line['itemName']),
      );
    };

    // Bounded concurrency (avoid sequential 100+ upserts timing out on free tier)
    const chunkSize = 12;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      await Promise.all(chunk.map((raw) => applyLine(raw)));
    }
  }

  private async handleStockIncrease(
    payload: BasePayload,
    shopId: string,
    event: Partial<
      Pick<
        ProjectionEvent,
        | 'id'
        | 'item_id'
        | 'quantity'
        | 'total_cost'
        | 'expiry_date'
        | 'unit_cost'
        | 'batch_number'
      >
    >,
  ): Promise<void> {
    const itemId = event.item_id || asString(payload.item_id) || null;
    const quantity = asNumber(
      event.quantity ??
        payload.quantity_approved ??
        payload.quantity ??
        payload.actual_quantity_produced,
    );
    let unitCost = asNumber(
      event.unit_cost ??
        payload.unit_cost ??
        payload.unitCost ??
        payload.cost_per_unit,
    );
    let totalCost = asNumber(
      event.total_cost ??
        payload.total_cost ??
        payload.totalCost ??
        payload.line_total,
    );
    if (totalCost <= 0 && unitCost > 0 && quantity > 0) {
      totalCost = unitCost * quantity;
    }
    if (unitCost <= 0 && totalCost > 0 && quantity > 0) {
      unitCost = totalCost / quantity;
    }
    // Always persist monetary value when we can derive it
    totalCost = Number.isFinite(totalCost) ? Math.round(totalCost * 100) / 100 : 0;
    unitCost = Number.isFinite(unitCost) ? Math.round(unitCost * 100) / 100 : 0;

    if (!itemId || quantity <= 0) return;

    await this.ensureItemExists(itemId, payload);

    // Fixed ROP seeded as ~20% of this receive (approved qty); not a moving % of on-hand.
    await this.maybeSeedReorderPointFromReceive(itemId, quantity, payload);

    let expiry: Date | null = event.expiry_date ?? null;
    if (!expiry && payload.expiry_date) {
      expiry = new Date(String(payload.expiry_date));
      if (Number.isNaN(expiry.getTime())) expiry = null;
    }

    const daysToExpiry = computeDaysToExpiry(expiry);

    const existingBefore = await this.activeDb.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });
    const qtyOnHandBefore = Number(existingBefore?.available_stock ?? 0);
    let oldWac = Number(existingBefore?.avg_unit_cost ?? 0);
    if (
      (!(oldWac > 0) || Number.isNaN(oldWac)) &&
      qtyOnHandBefore > 0 &&
      existingBefore
    ) {
      const tv = Number(existingBefore.total_value ?? 0);
      if (tv > 0) oldWac = tv / qtyOnHandBefore;
    }

    const newWac = this.fefoStock.computeNewWac(
      qtyOnHandBefore,
      oldWac,
      quantity,
      unitCost,
    );

    const row = await this.activeDb.inventoryProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        available_stock: { increment: quantity },
        total_value: { increment: totalCost },
        avg_unit_cost: newWac,
        last_receipt_unit_cost: unitCost > 0 ? unitCost : undefined,
        last_received_at: new Date(),
        ...(expiry ? { next_expiry_date: expiry } : {}),
        ...(daysToExpiry !== null ? { days_to_expiry_min: daysToExpiry } : {}),
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        available_stock: quantity,
        total_value: totalCost,
        avg_unit_cost: newWac,
        last_receipt_unit_cost: unitCost > 0 ? unitCost : null,
        expired_stock: 0,
        damaged_stock: 0,
        last_received_at: new Date(),
        next_expiry_date: expiry,
        days_to_expiry_min: daysToExpiry,
      },
    });

    try {
      const batchNumber =
        asString(payload.batch_number) ||
        asString((event as { batch_number?: string }).batch_number) ||
        `RCV-${Date.now()}`;
      await this.fefoStock.recordReceiveBatch({
        shopId,
        itemId,
        batchNumber: batchNumber || `RCV-${Date.now()}`,
        quantity,
        unitCost,
        expiryDate: expiry,
        supplierId: asString(payload.supplier_id) || null,
        eventId: asString((event as { id?: string }).id) || null,
        qtyOnHandBefore,
        oldWac,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FEFO recordReceiveBatch failed: ${message}`);
    }

    await this.emitStock(itemId, shopId, row, asString(payload.item_name));
  }

  private async handleWaste(
    payload: BasePayload,
    shopId: string,
    event: Pick<
      ProjectionEvent,
      'item_id' | 'quantity' | 'total_cost' | 'waste_reason'
    >,
  ): Promise<void> {
    const itemId = event.item_id || asString(payload.item_id);
    const quantity = Math.abs(
      asNumber(
        event.quantity ??
          payload.quantity_wasted ??
          payload.quantity_rejected ??
          payload.quantity,
      ),
    );
    const totalValue = asNumber(
      event.total_cost ?? payload.total_waste_value ?? payload.total_cost,
    );
    const reason = String(
      event.waste_reason || payload.waste_reason || payload.reason || '',
    ).toLowerCase();

    if (!itemId || quantity <= 0) return;

    await this.ensureItemExists(itemId, payload);

    const isDamage = reason.includes('damage');
    const isExpiry =
      reason.includes('spoil') ||
      reason.includes('expir') ||
      reason.includes('reject');

    const existing = await this.activeDb.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });
    const prev = Number(existing?.available_stock ?? 0);
    const nextStock = Math.max(0, prev - quantity);

    const row = await this.activeDb.inventoryProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        available_stock: nextStock,
        ...(isDamage ? { damaged_stock: { increment: quantity } } : {}),
        ...(isExpiry ? { expired_stock: { increment: quantity } } : {}),
        total_value: { decrement: totalValue },
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        available_stock: 0,
        damaged_stock: isDamage ? quantity : 0,
        expired_stock: isExpiry ? quantity : 0,
        total_value: 0,
      },
    });

    await this.upsertWasteProjection(
      shopId,
      itemId,
      quantity,
      totalValue,
      reason,
    );
    await this.emitStock(itemId, shopId, row, asString(payload.item_name));
  }

  private async handleBatchExpired(
    payload: BasePayload,
    shopId: string,
    event: Pick<ProjectionEvent, 'item_id' | 'quantity' | 'total_cost'>,
  ): Promise<void> {
    const itemId = event.item_id || asString(payload.item_id);
    const quantity = Math.abs(asNumber(event.quantity ?? payload.quantity));
    const totalValue = asNumber(event.total_cost ?? payload.total_cost);

    if (!itemId || quantity <= 0) return;

    await this.ensureItemExists(itemId, payload);

    const existing = await this.activeDb.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });
    const prev = Number(existing?.available_stock ?? 0);
    const nextStock = Math.max(0, prev - quantity);

    const row = await this.activeDb.inventoryProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        available_stock: nextStock,
        expired_stock: { increment: quantity },
        total_value: { decrement: totalValue },
        days_to_expiry_min: 0,
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        available_stock: 0,
        expired_stock: quantity,
        damaged_stock: 0,
        total_value: 0,
        days_to_expiry_min: 0,
      },
    });

    await this.upsertWasteProjection(
      shopId,
      itemId,
      quantity,
      totalValue,
      'expired',
    );
    await this.emitStock(itemId, shopId, row, asString(payload.item_name));
  }

  private async handleAdjustment(
    payload: BasePayload,
    shopId: string,
  ): Promise<void> {
    const itemId = asString(payload.item_id);
    const change = asNumber(payload.adjustment_quantity ?? payload.quantity);
    if (!itemId || change === 0) return;

    await this.ensureItemExists(itemId, payload);

    const reason = String(payload.reason || '').toLowerCase();
    const abs = Math.abs(change);

    const existing = await this.activeDb.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });
    const prev = Number(existing?.available_stock ?? 0);
    const nextStock = change > 0 ? prev + change : Math.max(0, prev - abs);

    const row = await this.activeDb.inventoryProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        available_stock: nextStock,
        ...(reason.includes('damage') && change < 0
          ? { damaged_stock: { increment: abs } }
          : {}),
        ...(reason.includes('expir') && change < 0
          ? { expired_stock: { increment: abs } }
          : {}),
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        available_stock: Math.max(0, change),
        damaged_stock: 0,
        expired_stock: 0,
        total_value: 0,
      },
    });

    if (change < 0 && (reason.includes('damage') || reason.includes('expir'))) {
      await this.upsertWasteProjection(shopId, itemId, abs, 0, reason);
    }
    await this.emitStock(itemId, shopId, row, asString(payload.item_name));
  }

  /**
   * Refill issued = replenishment into shop available stock (mini receive).
   * - +issued_qty on available_stock
   * - optional total_value / unit_cost
   * - batch/expiry from event or payload
   * - lost_weight recorded as waste only (not double-subtracted from the add)
   */
  private async handleRefillIssued(
    payload: BasePayload,
    shopId: string,
    event: Pick<
      ProjectionEvent,
      | 'item_id'
      | 'quantity'
      | 'total_cost'
      | 'unit_cost'
      | 'expiry_date'
      | 'batch_number'
    >,
  ): Promise<void> {
    const itemId = event.item_id || asString(payload.item_id);
    const issuedQty = asNumber(
      payload.issued_qty ??
        payload.approved_qty ??
        event.quantity ??
        payload.quantity,
    );
    const lostWeight = Math.max(0, asNumber(payload.lost_weight));

    if (!itemId || issuedQty <= 0) {
      this.logger.debug(
        `refill_issued skipped: itemId=${itemId ?? 'none'} qty=${issuedQty}`,
      );
      return;
    }

    await this.ensureItemExists(itemId, payload);

    let unitCost = asNumber(payload.unit_cost);
    const explicitTotal = asNumber(event.total_cost ?? payload.total_cost);
    let totalCost =
      explicitTotal > 0
        ? explicitTotal
        : unitCost > 0
          ? unitCost * issuedQty
          : 0;

    // Try to derive unit cost / value from existing stock if not provided
    if (totalCost <= 0) {
      const existing = await this.activeDb.inventoryProjection.findUnique({
        where: {
          shop_id_item_id: { shop_id: shopId, item_id: itemId },
        },
      });
      const stock = Number(existing?.available_stock ?? 0);
      const value = Number(existing?.total_value ?? 0);
      if (stock > 0 && value > 0) {
        unitCost = value / stock;
        totalCost = unitCost * issuedQty;
      }
    }

    // Determine expiry - keep earliest of existing or new batch (FEFO)
    let expiry: Date | null = event.expiry_date ?? null;
    if (!expiry && payload.expiry_date) {
      expiry = new Date(String(payload.expiry_date));
      if (Number.isNaN(expiry.getTime())) expiry = null;
    }

    // Read existing projection to keep nearest expiry (FEFO signal)
    const existing = await this.activeDb.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });

    // Keep nearer of existing on-hand expiry and this lot (FEFO signal)
    let nextExpiry: Date | null = existing?.next_expiry_date ?? null;
    if (expiry) {
      if (!nextExpiry || expiry.getTime() < nextExpiry.getTime()) {
        nextExpiry = expiry;
      }
    }
    const daysToExpiry = computeDaysToExpiry(nextExpiry);

    // Issue = stock LEAVES store inventory (kitchen/prep draw)
    const prevStock = Number(existing?.available_stock ?? 0);
    const prevValue = Number(existing?.total_value ?? 0);
    const nextStock = Math.max(0, prevStock - issuedQty);
    // Reduce value proportionally (or by explicit totalCost if known)
    let valueDrop = totalCost > 0 ? totalCost : 0;
    if (valueDrop <= 0 && prevStock > 0 && prevValue > 0) {
      valueDrop = (prevValue / prevStock) * Math.min(issuedQty, prevStock);
    }
    const nextValue = Math.max(0, prevValue - valueDrop);

    const row = await this.activeDb.inventoryProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        available_stock: nextStock,
        total_value: nextValue,
        ...(nextExpiry ? { next_expiry_date: nextExpiry } : {}),
        ...(daysToExpiry !== null ? { days_to_expiry_min: daysToExpiry } : {}),
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        available_stock: 0,
        total_value: 0,
        expired_stock: 0,
        damaged_stock: 0,
        last_received_at: existing?.last_received_at ?? null,
        next_expiry_date: nextExpiry,
        days_to_expiry_min: daysToExpiry,
      },
    });

    this.logger.debug(
      `Refill issued ${itemId}: -${issuedQty} (stock ${prevStock}→${nextStock}) value -${valueDrop.toFixed(2)} (lost_weight=${lostWeight})`,
    );

    if (lostWeight > 0) {
      await this.upsertWasteProjection(
        shopId,
        itemId,
        lostWeight,
        unitCost > 0 ? unitCost * lostWeight : 0,
        asString(payload.variance_reason) || 'refill_shrinkage',
      );
    }

    await this.emitStock(itemId, shopId, row, asString(payload.item_name));
  }

  /**
   * POS sale / kitchen / payment events share the same projection:
   * only the FIRST event per order_id should deduct stock. Subsequent
   * kitchen or payment status events must NOT re-deduct.
   */
  private async handlePosSale(
    payload: BasePayload,
    shopId: string,
    event: ProjectionEvent,
  ): Promise<void> {
    const totalAmount = asNumber(
      payload.total_amount ?? payload.total ?? payload.revenue,
    );
    // Business day key in UTC date-of-event (stable for period filters)
    const eventAt =
      event.created_at instanceof Date
        ? event.created_at
        : typeof (event as { created_at?: string }).created_at === 'string'
          ? new Date((event as { created_at: string }).created_at)
          : new Date();
    const period = eventAt.toISOString().slice(0, 10);

    /**
     * CRITICAL: pos_sale payloads always include payment_status / kitchen_status
     * (order is created with payment method and kitchen not_sent). The old check
     * treated every pos_sale as "payment-only" and NEVER wrote SalesProjection —
     * dashboard revenue/orders stayed 0 forever.
     *
     * Count revenue only on the initial `pos_sale` event.
     * Status/kitchen/payment follow-ups must not re-increment sales.
     */
    const shouldCountSale = event.event_type === 'pos_sale' && totalAmount > 0;

    if (shouldCountSale) {
      await this.activeDb.salesProjection.upsert({
        where: {
          shop_id_period: { shop_id: shopId, period },
        },
        update: {
          total_sales: { increment: totalAmount },
          total_orders: { increment: 1 },
        },
        create: {
          shop_id: shopId,
          period,
          total_sales: totalAmount,
          total_orders: 1,
          avg_order_value: totalAmount,
        },
      });

      const sales = await this.activeDb.salesProjection.findUnique({
        where: { shop_id_period: { shop_id: shopId, period } },
      });
      if (sales && sales.total_orders > 0) {
        await this.activeDb.salesProjection.update({
          where: { shop_id_period: { shop_id: shopId, period } },
          data: {
            avg_order_value:
              toMoneyNumber(sales.total_sales) / sales.total_orders,
          },
        });
      }
    }

    // Deduct stock only from explicit stock lines — no re-deduct on status events
    const deductions: Array<{
      item_id: string;
      quantity: number;
      unit_cost: number;
    }> = [];

    if (Array.isArray(payload.stock_deductions)) {
      for (const d of payload.stock_deductions) {
        const row = d as {
          item_id?: string;
          quantity?: number | string;
          unit_cost?: number | string;
        };
        const id = asString(row?.item_id);
        const qty = asNumber(row?.quantity);
        const unitCost = asNumber(row?.unit_cost);
        if (id && qty > 0) {
          deductions.push({ item_id: id, quantity: qty, unit_cost: unitCost });
        }
      }
    } else if (Array.isArray(payload.items)) {
      for (const line of payload.items) {
        const row = line as {
          item_id?: string;
          quantity?: number | string;
          unit_cost?: number | string;
          stock_deductions?: Array<{
            item_id?: string;
            quantity?: number | string;
            unit_cost?: number | string;
          }>;
        };
        if (Array.isArray(row.stock_deductions)) {
          for (const d of row.stock_deductions) {
            const id = asString(d?.item_id);
            const qty = asNumber(d?.quantity);
            const unitCost = asNumber(d?.unit_cost);
            if (id && qty > 0) {
              deductions.push({
                item_id: id,
                quantity: qty,
                unit_cost: unitCost,
              });
            }
          }
        } else {
          const id = asString(row?.item_id);
          const qty = asNumber(row?.quantity);
          if (id && qty > 0) {
            deductions.push({
              item_id: id,
              quantity: qty,
              unit_cost: asNumber(row?.unit_cost),
            });
          }
        }
      }
    }

    for (const d of deductions) {
      await this.ensureItemExists(d.item_id, {});

      let valueDrop = 0;
      let unitCostWac = d.unit_cost;
      try {
        const consumed = await this.fefoStock.consumeStock(
          shopId,
          d.item_id,
          d.quantity,
          { allowPartial: true },
        );
        unitCostWac =
          consumed.unitCostWac > 0 ? consumed.unitCostWac : d.unit_cost;
        valueDrop = consumed.value > 0 ? consumed.value : 0;
        if (consumed.slices.length) {
          this.logger.debug(
            `FEFO slices ${d.item_id}: ${consumed.slices
              .map((s) => `${s.batchNumber}:${s.quantity}`)
              .join(',')}`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`FEFO consume failed ${d.item_id}: ${message}`);
      }

      const existing = await this.activeDb.inventoryProjection.findUnique({
        where: {
          shop_id_item_id: { shop_id: shopId, item_id: d.item_id },
        },
      });
      const prev = Number(existing?.available_stock ?? 0);
      const nextStock = Math.max(0, prev - d.quantity);

      if (!(unitCostWac > 0) && prev > 0) {
        unitCostWac = Number(existing?.total_value ?? 0) / prev;
      }
      if (!(valueDrop > 0) && unitCostWac > 0) {
        valueDrop = unitCostWac * d.quantity;
      }
      const prevValue = Number(existing?.total_value ?? 0);
      const nextValue = Math.max(0, prevValue - valueDrop);

      const row = await this.activeDb.inventoryProjection.upsert({
        where: {
          shop_id_item_id: { shop_id: shopId, item_id: d.item_id },
        },
        update: {
          available_stock: nextStock,
          ...(valueDrop > 0 ? { total_value: nextValue } : {}),
        },
        create: {
          shop_id: shopId,
          item_id: d.item_id,
          available_stock: 0,
          total_value: 0,
          expired_stock: 0,
          damaged_stock: 0,
        },
      });
      await this.emitStock(d.item_id, shopId, row);
    }
  }

  private async emitStock(
    itemId: string,
    shopId: string,
    row: InventoryRow,
    itemName?: string,
  ): Promise<void> {
    if (!this.inventoryGateway) return;

    const name = itemName || itemId;
    const available = Number(row.available_stock ?? 0);
    const totalValue = toMoneyNumber(row.total_value ?? 0);
    const daysToExpiry =
      row.days_to_expiry_min === undefined || row.days_to_expiry_min === null
        ? null
        : Number(row.days_to_expiry_min);

    this.inventoryGateway.broadcastStockUpdate(
      {
        item_id: itemId,
        item_name: name,
        available_stock: available,
        total_value: totalValue,
        expired_stock: Number(row.expired_stock ?? 0),
        damaged_stock: Number(row.damaged_stock ?? 0),
        days_to_expiry_min: daysToExpiry,
        shop_id: shopId,
      },
      shopId,
    );

    const threshold = await this.resolveReorderThreshold(itemId);
    if (available <= threshold) {
      this.inventoryGateway.broadcastLowStockAlert(
        {
          item_id: itemId,
          item_name: name,
          current_stock: available,
          total_value: totalValue,
          threshold,
          shop_id: shopId,
        },
        shopId,
      );

      this.inventoryGateway.broadcastDashboardAlert({
        id: `low-${itemId}`,
        type: 'low_stock',
        severity: available <= 3 ? 'critical' : 'warning',
        message: `Low stock: ${name} (${available} left)`,
        href: `/inventory?highlight=${itemId}`,
        shop_id: shopId,
        item_id: itemId,
      });
    }

    if (daysToExpiry !== null && daysToExpiry <= 3) {
      const dayLabel = daysToExpiry === 1 ? '' : 's';
      this.inventoryGateway.broadcastDashboardAlert({
        id: `expiry-${itemId}`,
        type: 'near_expiry',
        severity: daysToExpiry <= 1 ? 'critical' : 'warning',
        message: `Near expiry: ${name} (${daysToExpiry} day${dayLabel} left)`,
        href: `/inventory?highlight=${itemId}`,
        shop_id: shopId,
        item_id: itemId,
      });
    }
  }

  /**
   * suggested_reorder_point = max(floor, round(0.20 × quantity_approved, 3))
   * Alerts compare available_stock <= Item.reorder_point (fixed, not % of on-hand).
   */
  private suggestReorderFromReceiveQty(approvedQty: number): number {
    if (!Number.isFinite(approvedQty) || approvedQty <= 0) {
      return UNSET_REORDER_POINT;
    }
    const raw = approvedQty * REORDER_PCT_OF_RECEIVE;
    const rounded = Math.round(raw * 1000) / 1000;
    return Math.max(REORDER_FLOOR, rounded);
  }

  private isSystemDefaultReorder(value: number | null | undefined): boolean {
    if (value == null) return true;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return true;
    // Legacy global default of 10 — eligible to be replaced by 20% of receive
    if (n === LEGACY_DEFAULT_REORDER_POINT) return true;
    return false;
  }

  /**
   * Seed or replace only unset / legacy-default ROP. Never overwrite manager-edited values.
   */
  private async maybeSeedReorderPointFromReceive(
    itemId: string,
    approvedQty: number,
    payload: BasePayload,
  ): Promise<void> {
    const explicit = asNumber(payload.reorder_point, 0);
    const suggested =
      explicit > 0 ? explicit : this.suggestReorderFromReceiveQty(approvedQty);
    if (suggested <= 0) return;

    const existing = await this.activeDb.item.findUnique({
      where: { item_id: itemId },
      select: { reorder_point: true },
    });
    if (!existing) return;

    if (!this.isSystemDefaultReorder(existing.reorder_point)) {
      return;
    }

    await this.activeDb.item.update({
      where: { item_id: itemId },
      data: { reorder_point: suggested },
    });
  }

  private async resolveReorderThreshold(itemId: string): Promise<number> {
    const item = await this.activeDb.item.findUnique({
      where: { item_id: itemId },
      select: { reorder_point: true },
    });
    const n = Number(item?.reorder_point ?? 0);
    return Number.isFinite(n) && n > 0 ? n : UNSET_REORDER_POINT;
  }

  private async ensureItemExists(
    itemId: string,
    payload: BasePayload,
  ): Promise<void> {
    const existing = await this.activeDb.item.findUnique({
      where: { item_id: itemId },
    });

    const category = asString(payload.category) || DEFAULT_CATEGORY;
    const explicitReorder = asNumber(payload.reorder_point, 0);
    const minStock = Math.max(0, asNumber(payload.min_stock, 0));
    const name = asString(payload.item_name) || itemId;
    const unit = asString(payload.units) || asString(payload.unit) || 'pcs';

    if (!existing) {
      await this.activeDb.item.create({
        data: {
          item_id: itemId,
          name,
          unit,
          category,
          // 0 = unset until first receive seeds ~20% of approved qty
          reorder_point:
            explicitReorder > 0 ? explicitReorder : UNSET_REORDER_POINT,
          min_stock: minStock,
        },
      });
      return;
    }

    const needsCategory = !existing.category || existing.category.trim() === '';
    if (needsCategory) {
      await this.activeDb.item.update({
        where: { item_id: itemId },
        data: { category: DEFAULT_CATEGORY },
      });
    }
  }

  private async upsertWasteProjection(
    shopId: string,
    itemId: string,
    quantity: number,
    totalValue: number,
    reason: string,
  ): Promise<void> {
    const existing = await this.activeDb.wasteProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });

    const reasonKey = reason || 'other';
    const prevSummary =
      (existing?.reason_summary as Record<string, number> | null) || {};
    const nextSummary: Record<string, number> = {
      ...prevSummary,
      [reasonKey]: Number(prevSummary[reasonKey] || 0) + quantity,
    };

    await this.activeDb.wasteProjection.upsert({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
      update: {
        total_wasted: { increment: quantity },
        total_value: { increment: totalValue },
        reason_summary: nextSummary,
        last_wasted_at: new Date(),
      },
      create: {
        shop_id: shopId,
        item_id: itemId,
        total_wasted: quantity,
        total_value: totalValue,
        reason_summary: nextSummary,
        last_wasted_at: new Date(),
      },
    });
  }

  private async logFailure(eventId: string, error: unknown): Promise<void> {
    try {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';

      await this.activeDb.projectionLog.create({
        data: {
          projection_type: 'general',
          event_id: eventId,
          status: 'failed',
          error_message: message,
        },
      });
    } catch {
      // ignore secondary failures
    }
  }
}
