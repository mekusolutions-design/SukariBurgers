import { toMoneyNumber } from '../../common/utils/money.util';
// apps/api/src/modules/waste/waste.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventStoreService } from '../../core/event-store.service';
import { IdempotencyService } from '../../core/idempotency.service';
import { RecordWasteDto } from './dto/record-waste.dto';
import { WasteGateway } from './waste.gateway';
import { quantityInItemUnit } from '../../common/utils/stock-units';
import { UnitConversionService } from '../../common/units/unit-conversion.service';

type WasteCause =
  | 'expired'
  | 'spoiled'
  | 'prep_error'
  | 'customer_return'
  | 'overproduction'
  | 'other';

interface IdempotencyExisting {
  id: string;
  payload: unknown;
  event_type?: string;
}

interface IdempotencyResult {
  isReplay: boolean;
  existing?: IdempotencyExisting;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isRejectedPayload(payload: Record<string, unknown>): boolean {
  return payload.rejected === true || payload.approval_status === 'rejected';
}

function daysToExpiry(
  nextExpiryDate: Date | string | null | undefined,
): number | null {
  if (!nextExpiryDate) return null;
  const end = new Date(nextExpiryDate);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

@Injectable()
export class WasteService {
  private readonly logger = new Logger(WasteService.name);

  constructor(
    private readonly eventStore: EventStoreService,
    private readonly idempotencyService: IdempotencyService,
    private readonly wasteGateway: WasteGateway,
    private readonly prisma: PrismaService,
    private readonly units: UnitConversionService,
  ) {}

  async recordWaste(dto: RecordWasteDto, actorUserId: string) {
    const shopId = asString(
      (dto as { shop_id?: string }).shop_id ??
        (dto as { shopId?: string }).shopId,
      '1',
    );

    // Production waste: stable key per batch so retries never double-insert (Michael F2).
    // Other sources keep a short time bucket only as last resort for true duplicates.
    const batchKey =
      (dto.batch_number && String(dto.batch_number).trim()) ||
      (dto.payload &&
      typeof dto.payload === 'object' &&
      (dto.payload as { production_id?: string }).production_id) ||
      '';
    const idempotencyKey =
      dto.module_source === 'production' && batchKey
        ? `waste-production-${dto.item_id}-${batchKey}`
        : `waste-${dto.module_source}-${dto.item_id}-${dto.quantity_wasted}-${(dto.waste_reason || 'none').slice(0, 40)}`;

    const result = (await this.idempotencyService.enforce(
      idempotencyKey,
      dto,
    )) as IdempotencyResult;

    if (result.isReplay && result.existing) {
      const existingPayload = asRecord(result.existing.payload);
      return {
        success: true,
        wasteId: existingPayload.waste_id,
        eventId: result.existing.id,
        message: 'Already processed (idempotent replay)',
      };
    }

    const qty = asNumber(dto.quantity_wasted, 0);

    let unitCost =
      dto.unit_cost != null && asNumber(dto.unit_cost, 0) > 0
        ? asNumber(dto.unit_cost, 0)
        : null;

    let totalValue =
      dto.total_waste_value != null && asNumber(dto.total_waste_value, 0) > 0
        ? asNumber(dto.total_waste_value, 0)
        : null;

    // cost resolve uses input qty; event stores storage qty
    const resolved = await this.resolveWasteCost(
      dto.item_id,
      shopId,
      qty,
      unitCost,
    );

    // Spec: live WAC wins over client-supplied cost when WAC is available
    if (resolved.unitCost > 0) {
      unitCost = resolved.unitCost;
      if (totalValue == null || totalValue <= 0) {
        totalValue = resolved.totalValue;
      }
    } else if (unitCost == null || unitCost <= 0) {
      unitCost = resolved.unitCost;
    }

    const catalog = await this.prisma.item.findUnique({
      where: { item_id: dto.item_id },
    });
    let itemName = asString(dto.item_name);
    if (!itemName || itemName === dto.item_id) {
      itemName = catalog?.name || dto.item_id;
    }

    const storageUnit = catalog?.unit || 'pcs';
    const inputUom = asString(dto.unit_of_measure) || storageUnit || 'pcs';
    // Align waste qty with InventoryProjection denomination (Item.unit)
    const qtyInStorage = quantityInItemUnit(qty, inputUom, storageUnit);
    const unitOfMeasure = storageUnit;
    const qtyStored = qtyInStorage;

    // Value uses storage-unit qty × unit cost (cost is per storage unit)
    if (totalValue == null || totalValue <= 0) {
      try {
        totalValue = this.units.lineCost(
          qty,
          unitOfMeasure,
          unitCost ?? 0,
          storageUnit,
        );
      } catch {
        totalValue = (unitCost ?? 0) * qty;
      }
    }

    const wasteId = `WASTE-${dto.item_id}-${Date.now().toString(36)}`;
    const recordedAt = new Date().toISOString();

    const event = await this.eventStore.appendEvent({
      event_type: 'waste_recorded',
      actor_user_id: actorUserId,
      idempotency_key: idempotencyKey,
      batch_number: dto.batch_number,
      waste_reason: dto.waste_reason,
      item_id: dto.item_id,
      quantity: qtyStored,
      unit_cost: unitCost ?? 0,
      total_cost: totalValue ?? 0,
      payload: {
        waste_id: wasteId,
        ...dto,
        item_name: itemName,
        shop_id: shopId,
        unit_of_measure: unitOfMeasure,
        unit_cost: unitCost ?? 0,
        total_waste_value: totalValue ?? 0,
        quantity_wasted: qtyStored,
        recorded_at: recordedAt,
      },
    });

    try {
      this.wasteGateway.broadcastWasteRecorded({
        waste_id: wasteId,
        ...dto,
        item_name: itemName,
        unit_of_measure: unitOfMeasure,
        unit_cost: unitCost ?? 0,
        total_waste_value: totalValue ?? 0,
        recorded_at: recordedAt,
      });
    } catch {
      // gateway optional
    }

    if (dto.severity === 'critical' || (totalValue ?? 0) > 5000) {
      this.logger.warn(
        `CRITICAL WASTE: ${qty} ${unitOfMeasure} of ${itemName} (KES ${totalValue})`,
      );
    }

    return {
      success: true,
      wasteId,
      eventId: event.id,
      unitCost: unitCost ?? 0,
      totalWasteValue: totalValue ?? 0,
      itemName,
      message: 'Waste recorded successfully',
    };
  }

  /**
   * Only past calendar expiry with stock still on hand.
   * Do NOT use expired_stock alone (avoids false positives like ZESTA/Buns).
   */
  async listExpiredCandidates(shopId: string = '1') {
    const rows = await this.prisma.inventoryProjection.findMany({
      where: { shop_id: shopId },
      include: {
        item: { select: { name: true, unit: true } },
      },
      take: 500,
    });

    const items = rows
      .map((r) => {
        const days = daysToExpiry(r.next_expiry_date);
        const available = Number(r.available_stock ?? 0);
        const expiredQty = Number(r.expired_stock ?? 0);
        const isPastExpiry = days != null && days < 0;
        return {
          item_id: r.item_id,
          item_name: r.item?.name ?? r.item_id,
          unit: r.item?.unit ?? 'pcs',
          available_stock: available,
          expired_stock: expiredQty,
          days_to_expiry_min: days,
          next_expiry_date: r.next_expiry_date,
          total_value: Number(r.total_value ?? 0),
          write_off_qty: available > 0 && isPastExpiry ? available : 0,
          isExpired: isPastExpiry,
        };
      })
      .filter((r) => r.isExpired && r.write_off_qty > 0);

    return {
      success: true,
      items,
      count: items.length,
    };
  }

  /**
   * Write off remaining available stock for past-expiry item(s) as waste_recorded.
   * Projection engine then reduces available_stock and bumps expired_stock.
   */
  async writeOffExpired(opts: {
    shopId: string;
    actorUserId: string;
    itemId?: string;
  }) {
    const shopId = opts.shopId || '1';
    const candidates = await this.listExpiredCandidates(shopId);
    let targets = candidates.items;

    if (opts.itemId) {
      targets = targets.filter((t) => t.item_id === opts.itemId);
      if (targets.length === 0) {
        throw new NotFoundException(
          `No expired stock to write off for item ${opts.itemId}`,
        );
      }
    }

    const results: Array<{
      itemId: string;
      itemName: string;
      quantity: number;
      eventId: string;
      wasteId: unknown;
    }> = [];

    for (const row of targets) {
      const recorded = await this.recordWaste(
        {
          module_source: 'inventory',
          item_id: row.item_id,
          item_name: row.item_name,
          shop_id: shopId,
          quantity_wasted: row.write_off_qty,
          unit_of_measure: row.unit,
          waste_type: 'spoilage',
          waste_reason: 'expired product write-off',
          root_cause: 'inherent',
          severity: 'high',
          notes: `Auto write-off for expired stock (${row.days_to_expiry_min ?? 'n/a'} days to expiry)`,
        },
        opts.actorUserId,
      );

      results.push({
        itemId: row.item_id,
        itemName: row.item_name,
        quantity: row.write_off_qty,
        eventId: recorded.eventId,
        wasteId: recorded.wasteId,
      });
    }

    return {
      success: true,
      writtenOff: results,
      count: results.length,
      message:
        results.length === 0
          ? 'No expired stock with available quantity to write off'
          : `Wrote off ${results.length} expired item(s)`,
    };
  }

  private async resolveWasteCost(
    itemId: string,
    shopId: string,
    quantity: number,
    knownUnitCost: number | null,
  ): Promise<{ unitCost: number; totalValue: number }> {
    // Spec: waste value = qty × current WAC (ignore stale client unit cost when WAC exists)
    const stock = await this.prisma.inventoryProjection.findUnique({
      where: {
        shop_id_item_id: { shop_id: shopId, item_id: itemId },
      },
    });

    const available = Number(stock?.available_stock ?? 0);
    const stockValue = Number(stock?.total_value ?? 0);
    let unitCost = Number(stock?.avg_unit_cost ?? 0);
    if (!(unitCost > 0) && available > 0 && stockValue > 0) {
      unitCost = stockValue / available;
    }
    if (!(unitCost > 0) || !Number.isFinite(unitCost)) {
      unitCost =
        knownUnitCost != null && knownUnitCost > 0 ? knownUnitCost : 0;
    }

    return {
      unitCost,
      totalValue: unitCost * quantity,
    };
  }

  /**
   * Sum purchase / GRN value for the same shop + time window.
   * Ratio = totalWasteValue / totalPurchases (0–1 for formatPercent).
   */
  private async sumPurchasesInRange(
    shopId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const receiveEvents = await this.prisma.event.findMany({
      where: {
        shop_id: shopId,
        event_type: {
          in: [
            'received',
            'RECEIVING',
            'goods_received',
            'stock_received',
            'receive_goods',
          ],
        },
        created_at: {
          gte: start,
          lte: end,
        },
      },
      select: {
        total_cost: true,
        quantity: true,
        unit_cost: true,
        payload: true,
      },
      take: 5000,
    });

    let totalPurchases = 0;

    for (const e of receiveEvents) {
      const p = asRecord(e.payload);
      if (isRejectedPayload(p)) continue;

      let cost = asNumber(
        e.total_cost ?? p.total_cost ?? p.total_amount ?? p.totalCost,
      );

      if (cost <= 0) {
        const qty = asNumber(p.quantity_approved ?? p.quantity ?? e.quantity);
        const unit = asNumber(p.unit_cost ?? e.unit_cost);
        if (qty > 0 && unit > 0) {
          cost = qty * unit;
        }
      }

      totalPurchases += cost;
    }

    return totalPurchases;
  }

  async getWasteAnalytics(filters: {
    start_date: Date;
    end_date: Date;
    item_id?: string;
    shop_id?: string;
  }) {
    const shopId = filters.shop_id || '1';

    const events = await this.prisma.event.findMany({
      where: {
        shop_id: shopId,
        event_type: { in: ['waste_recorded', 'waste', 'WASTE_RECORDED'] },
        created_at: {
          gte: filters.start_date,
          lte: filters.end_date,
        },
        ...(filters.item_id ? { item_id: filters.item_id } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 5000,
    });

    const counted = events.filter(
      (e) => !isRejectedPayload(asRecord(e.payload)),
    );

    let totalValue = 0;
    let totalQty = 0;
    const byCauseValue: Record<string, number> = {};
    const byCauseQty: Record<string, number> = {};
    const byItem = new Map<
      string,
      {
        itemId: string;
        name: string;
        unit: string;
        quantity: number;
        value: number;
        count: number;
      }
    >();

    // Preload WAC for items that have zero stored waste value
    const zeroValueItemIds = new Set<string>();
    for (const e of counted) {
      const p = asRecord(e.payload);
      const value = toMoneyNumber(e.total_cost ?? p.total_waste_value);
      const qty = asNumber(e.quantity ?? p.quantity_wasted);
      const unitCost = asNumber(e.unit_cost ?? p.unit_cost, 0);
      if (qty > 0 && value <= 0 && unitCost <= 0) {
        const id = asString(e.item_id ?? p.item_id);
        if (id) zeroValueItemIds.add(id);
      }
    }
    const wacByItem = new Map<string, number>();
    if (zeroValueItemIds.size > 0) {
      const stocks = await this.prisma.inventoryProjection.findMany({
        where: {
          shop_id: shopId,
          item_id: { in: [...zeroValueItemIds] },
        },
        select: {
          item_id: true,
          avg_unit_cost: true,
          available_stock: true,
          total_value: true,
        },
      });
      for (const s of stocks) {
        let wac = Number(s.avg_unit_cost ?? 0);
        const aq = Number(s.available_stock ?? 0);
        const tv = Number(s.total_value ?? 0);
        if (!(wac > 0) && aq > 0 && tv > 0) wac = tv / aq;
        if (wac > 0) wacByItem.set(s.item_id, wac);
      }
    }

    for (const e of counted) {
      const p = asRecord(e.payload);
      let value = toMoneyNumber(e.total_cost ?? p.total_waste_value);
      const qty = asNumber(e.quantity ?? p.quantity_wasted);
      let unitCost = asNumber(e.unit_cost ?? p.unit_cost, 0);

      if (value <= 0 && unitCost > 0 && qty > 0) {
        value = unitCost * qty;
      }
      if (value <= 0 && qty > 0) {
        const itemId = asString(e.item_id ?? p.item_id);
        const wac = itemId ? wacByItem.get(itemId) ?? 0 : 0;
        if (wac > 0) {
          unitCost = wac;
          value = wac * qty;
        }
      }

      const cause = this.mapCause(
        asString(e.waste_reason ?? p.waste_reason, 'other'),
      );
      const itemId = asString(e.item_id ?? p.item_id, 'unknown');
      const itemName = asString(p.item_name ?? p.itemName ?? p.name, itemId);
      const unit = asString(p.unit_of_measure ?? p.unit, 'pcs');

      totalValue += value;
      totalQty += qty;
      byCauseValue[cause] = (byCauseValue[cause] || 0) + value;
      byCauseQty[cause] = (byCauseQty[cause] || 0) + qty;

      const prev = byItem.get(itemId);
      if (!prev) {
        byItem.set(itemId, {
          itemId,
          name: itemName,
          unit,
          quantity: qty,
          value,
          count: 1,
        });
      } else {
        prev.quantity += qty;
        prev.value += value;
        prev.count += 1;
        if ((!prev.name || prev.name === prev.itemId) && itemName) {
          prev.name = itemName;
        }
        if (prev.unit === 'pcs' && unit !== 'pcs') {
          prev.unit = unit;
        }
      }
    }

    const missingNameIds = Array.from(byItem.values())
      .filter((r) => !r.name || r.name === r.itemId)
      .map((r) => r.itemId);

    if (missingNameIds.length > 0) {
      const catalog = await this.prisma.item.findMany({
        where: { item_id: { in: missingNameIds } },
        select: { item_id: true, name: true, unit: true },
      });
      for (const it of catalog) {
        const row = byItem.get(it.item_id);
        if (row) {
          row.name = it.name || row.name;
          if (it.unit) row.unit = it.unit;
        }
      }
    }

    const topItems = Array.from(byItem.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((row) => ({
        itemId: row.itemId,
        name: row.name || row.itemId,
        unit: row.unit || 'pcs',
        quantity: row.quantity,
        value: row.value,
        incidentCount: row.count,
      }));

    const causeKeys = new Set([
      ...Object.keys(byCauseValue),
      ...Object.keys(byCauseQty),
    ]);
    const byCauseList = Array.from(causeKeys).map((cause) => ({
      cause,
      value: byCauseValue[cause] || 0,
      quantity: byCauseQty[cause] || 0,
    }));

    const totalPurchases = await this.sumPurchasesInRange(
      shopId,
      filters.start_date,
      filters.end_date,
    );

    const wastePercentOfPurchases =
      totalPurchases > 0 ? totalValue / totalPurchases : null;

    return {
      totalWasteValue: totalValue,
      totalWasteQuantity: totalQty,
      totalWastedValue: totalValue,
      totalWastedQuantity: totalQty,
      wasteIncidents: counted.length,
      wastePercentOfPurchases,
      totalPurchasesValue: totalPurchases,
      byCause: byCauseList,
      topItems,
      total_waste_value: totalValue,
      total_waste_quantity: totalQty,
      waste_incidents: counted.length,
      total_purchases_value: totalPurchases,
      waste_percent_of_purchases: wastePercentOfPurchases,
      by_waste_type: byCauseValue,
      by_root_cause: byCauseValue,
      top_waste_items: topItems,
    };
  }

  async listEvents(opts: {
    shopId: string;
    page: number;
    pageSize: number;
    from?: Date;
    to?: Date;
    includeRejected?: boolean;
  }) {
    const take = Math.min(Math.max(opts.pageSize || 25, 1), 100);
    const skip = (Math.max(opts.page || 1, 1) - 1) * take;

    const where: {
      shop_id: string;
      event_type: { in: string[] };
      created_at?: { gte?: Date; lte?: Date };
    } = {
      shop_id: opts.shopId,
      event_type: { in: ['waste_recorded', 'waste', 'WASTE_RECORDED'] },
    };

    if (opts.from || opts.to) {
      where.created_at = {};
      if (opts.from) where.created_at.gte = opts.from;
      if (opts.to) where.created_at.lte = opts.to;
    }

    const rows = await this.prisma.event.findMany({
      where,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    const includeRejected = opts.includeRejected === true;

    const mapped = rows
      .map((e) => {
        const p = asRecord(e.payload);
        const rejected = isRejectedPayload(p);
        const qty = asNumber(e.quantity ?? p.quantity_wasted);
        const unitCost = asNumber(e.unit_cost ?? p.unit_cost, 0);
        let value = toMoneyNumber(e.total_cost ?? p.total_waste_value);
        if (value === 0 && unitCost > 0 && qty > 0) {
          value = unitCost * qty;
        }

        return {
          id: e.id,
          itemId: asString(e.item_id ?? p.item_id),
          itemName: asString(p.item_name ?? e.item_id),
          quantity: qty,
          unit: asString(p.unit_of_measure ?? p.unit, 'pcs'),
          cause: this.mapCause(
            asString(e.waste_reason ?? p.waste_reason, 'other'),
          ),
          value,
          reportedBy: e.actor?.name || e.actor?.email || 'Unknown',
          moduleSource: asString(p.module_source, 'unknown'),
          createdAt: e.created_at.toISOString(),
          photoUrl: e.waste_photo_url ?? p.waste_photo_url ?? null,
          notes: p.notes ?? null,
          rejected,
          batchNumber: asString(e.batch_number ?? p.batch_number, '') || null,
        };
      })
      .filter((row) => includeRejected || !row.rejected);

    const total = mapped.length;
    const items = mapped.slice(skip, skip + take);

    return {
      items,
      total,
      page: Math.max(opts.page || 1, 1),
      pageSize: take,
      totalPages: Math.ceil(total / take) || 1,
    };
  }

  async getEvent(eventId: string) {
    const e = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { actor: { select: { name: true, email: true } } },
    });

    if (!e) {
      throw new NotFoundException(`Waste event ${eventId} not found`);
    }

    const p = asRecord(e.payload);
    const rejected = isRejectedPayload(p);
    const qty = asNumber(e.quantity ?? p.quantity_wasted);
    const unitCost = asNumber(e.unit_cost ?? p.unit_cost, 0);
    let value = toMoneyNumber(e.total_cost ?? p.total_waste_value);
    if (value === 0 && unitCost > 0 && qty > 0) {
      value = unitCost * qty;
    }

    return {
      id: e.id,
      itemId: asString(e.item_id ?? p.item_id),
      itemName: asString(p.item_name ?? e.item_id),
      quantity: qty,
      unit: asString(p.unit_of_measure ?? p.unit, 'pcs'),
      cause: this.mapCause(asString(e.waste_reason ?? p.waste_reason, 'other')),
      value,
      reportedBy: e.actor?.name || e.actor?.email || 'Unknown',
      moduleSource: asString(p.module_source, 'unknown'),
      createdAt: e.created_at.toISOString(),
      photoUrl: e.waste_photo_url ?? p.waste_photo_url ?? null,
      notes: p.notes ?? null,
      rejected,
      batchNumber: asString(e.batch_number ?? p.batch_number, '') || null,
    };
  }

  private mapCause(reason: string): WasteCause {
    const r = reason.toLowerCase();
    if (r.includes('expir')) return 'expired';
    if (r.includes('spoil') || r.includes('rot')) return 'spoiled';
    if (r.includes('prep') || r.includes('cook')) return 'prep_error';
    if (r.includes('return') || r.includes('customer')) {
      return 'customer_return';
    }
    if (r.includes('over')) return 'overproduction';
    return 'other';
  }
}
