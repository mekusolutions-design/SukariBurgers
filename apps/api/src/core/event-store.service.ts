// apps/api/src/core/event-store.service.ts
import {
  ConflictException,
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectionEngineService } from './projection-engine.service';
import { normalizeSku } from '../common/utils/sku.util';
import { toMoneyNumber } from '../common/utils/money.util';
import {
  payloadsEqual,
  resolveShopIdFromPayload,
} from './event-store.logic';


const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return UUID_RE.test(v) ? v : null;
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return String(value);
  }
  return fallback;
}

type TxClient = Prisma.TransactionClient;

@Injectable()
export class EventStoreService {
  private readonly logger = new Logger(EventStoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProjectionEngineService))
    private readonly projectionEngine: ProjectionEngineService,
  ) {}

  async appendEvent(data: {
    event_type: string;
    actor_user_id?: string;
    idempotency_key: string;
    batch_number?: string;
    expiry_date?: Date;
    waste_reason?: string;
    waste_photo_url?: string;
    item_id?: string;
    quantity?: number;
    unit_cost?: number;
    total_cost?: number;
    supplier_id?: string;
    approved_by_id?: string;
    payload: Record<string, unknown>;
  }) {
    // Fast path: identical replay outside the write lock
    const existing = await this.prisma.event.findUnique({
      where: { idempotency_key: data.idempotency_key },
    });

    if (existing) {
      if (payloadsEqual(existing.payload, data.payload)) {
        this.logger.debug(`Idempotent replay: ${data.idempotency_key}`);
        return existing;
      }
      throw new ConflictException(
        'Idempotency key already used with different payload',
      );
    }

    const rawBusinessId =
      data.item_id ??
      (typeof data.payload?.item_id === 'string' ? data.payload.item_id : null);
    const businessItemId = rawBusinessId ? normalizeSku(rawBusinessId) : null;

    const quantity = this.resolveQuantity(data);
    const unitCost =
      data.unit_cost ??
      (typeof data.payload?.unit_cost === 'number'
        ? data.payload.unit_cost
        : null);
    const totalCost =
      data.total_cost ??
      (typeof data.payload?.total_cost === 'number'
        ? data.payload.total_cost
        : typeof data.payload?.total_waste_value === 'number'
          ? data.payload.total_waste_value
          : null);

    const payload: Record<string, unknown> = { ...data.payload };
    if (businessItemId) {
      payload.item_id = businessItemId;
      if (typeof payload.itemId === 'string') {
        payload.itemId = businessItemId;
      }
    }

    const shopId = asString(
      payload.shop_id ?? payload.shopId,
      '1',
    );
    payload.shop_id = shopId;

    const unitCostMoney =
      unitCost === null || unitCost === undefined
        ? null
        : toMoneyNumber(unitCost);
    const totalCostMoney =
      totalCost === null || totalCost === undefined
        ? null
        : toMoneyNumber(totalCost);

    const actorUserId = asUuid(data.actor_user_id);
    const supplierId = asUuid(data.supplier_id);
    const approvedById = asUuid(data.approved_by_id);

    let event;
    try {
      // Atomic: ensure master Item + insert Event (idempotency unique enforces races)
      event = await this.prisma.$transaction(async (tx: TxClient) => {
        const again = await tx.event.findUnique({
          where: { idempotency_key: data.idempotency_key },
        });
        if (again) {
          if (payloadsEqual(again.payload, data.payload)) {
            return again;
          }
          throw new ConflictException(
            'Idempotency key already used with different payload',
          );
        }

        if (businessItemId) {
          await this.ensureItemExistsTx(tx, businessItemId, payload);
        }

        const created = await tx.event.create({
          data: {
            event_type: data.event_type,
            shop_id: shopId,
            actor_user_id: actorUserId,
            idempotency_key: data.idempotency_key,
            batch_number: data.batch_number,
            expiry_date: data.expiry_date,
            waste_reason: data.waste_reason,
            waste_photo_url: data.waste_photo_url,
            item_id: businessItemId,
            quantity,
            unit_cost: unitCostMoney,
            total_cost: totalCostMoney,
            supplier_id: supplierId,
            approved_by_id: approvedById,
            payload: payload as Prisma.InputJsonValue,
          },
        });

        // Event only inside TX — projections run after commit.
        // Holding FEFO / multi-row projection work in an interactive TX
        // exceeds Prisma's timeout on remote Postgres (Render + Supabase).
        return created;
      },
      {
        maxWait: 20_000,
        timeout: 30_000,
      },
      );

      // After durable event: apply read models (can be slower; rebuild-safe)
      try {
        await this.projectionEngine.updateProjections(event as any);
      } catch (projErr: unknown) {
        const message =
          projErr instanceof Error ? projErr.message : String(projErr);
        this.logger.error(
          `Projection failed after event ${event.id} (${data.event_type}): ${message}`,
          projErr instanceof Error ? projErr.stack : undefined,
        );
        // Event is committed — do not fail the write; projections can rebuild
      }
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.event.findUnique({
          where: { idempotency_key: data.idempotency_key },
        });
        if (
          raced &&
          payloadsEqual(raced.payload, data.payload)
        ) {
          return raced;
        }
        throw new ConflictException(
          'Idempotency key already used with different payload',
        );
      }
      throw err;
    }

    this.logger.log(`Event stored: ${data.event_type} (${event.id})`);
    return event;
  }

  private async ensureItemExistsTx(
    tx: TxClient,
    businessItemId: string,
    payload: Record<string, unknown>,
  ) {
    const sku = normalizeSku(businessItemId);
    if (!sku) return null;

    const existing = await tx.item.findUnique({
      where: { item_id: sku },
      select: { id: true },
    });
    if (existing) return existing;

    const name = asString(payload.item_name, sku);
    const unitSource =
      typeof payload.units === 'string'
        ? payload.units
        : typeof payload.unit === 'string'
          ? payload.unit
          : undefined;
    const unit = asString(unitSource, 'pcs');
    const category =
      typeof payload.category === 'string' ? payload.category : null;

    const created = await tx.item.create({
      data: {
        item_id: sku,
        name,
        unit,
        category,
      },
    });

    this.logger.debug(`Auto-created Item: ${sku}`);
    return created;
  }

  private resolveQuantity(data: {
    quantity?: number;
    payload: Record<string, unknown>;
  }): number | null {
    if (typeof data.quantity === 'number') return data.quantity;

    const p = data.payload;
    const candidates = [
      p.quantity,
      p.quantity_approved,
      p.actual_quantity_produced,
      p.quantity_wasted,
      p.issued_qty,
      p.approved_qty,
      p.adjustment_quantity,
    ];

    for (const c of candidates) {
      if (typeof c === 'number' && !Number.isNaN(c)) return c;
    }
    return null;
  }

  async getEventsForItem(itemId: string, opts?: { take?: number }) {
    const sku = normalizeSku(itemId);
    const take = Math.min(Math.max(opts?.take ?? 200, 1), 1000);
    return this.prisma.event.findMany({
      where: {
        OR: [{ item_id: sku }, { payload: { path: ['item_id'], equals: sku } }],
      },
      orderBy: { created_at: 'asc' },
      take,
    });
  }

  async getLatestEventForItem(itemId: string) {
    const sku = normalizeSku(itemId);
    return this.prisma.event.findFirst({
      where: {
        OR: [{ item_id: sku }, { payload: { path: ['item_id'], equals: sku } }],
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getAllEvents(params?: {
    take?: number;
    skip?: number;
    shopId?: string;
    eventTypes?: string[];
  }) {
    const take = Math.min(Math.max(params?.take ?? 200, 1), 1000);
    return this.prisma.event.findMany({
      where: {
        ...(params?.shopId ? { shop_id: params.shopId } : {}),
        ...(params?.eventTypes?.length
          ? { event_type: { in: params.eventTypes } }
          : {}),
      },
      orderBy: { created_at: 'asc' },
      take,
      skip: params?.skip ?? 0,
    });
  }
}
