// apps/api/src/jobs/expiry-sweep.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { EventStoreService } from '../core/event-store.service';

/**
 * Daily expiry sweep — IDEMPOTENT
 *
 * Fully expired batches → one `batch_expired` event (key: expiry-{sourceEventId})
 * Near-expiry (1–7 days) → refresh days_to_expiry_min + alert only
 */
@Processor('expiry-sweep')
@Injectable()
export class ExpirySweepProcessor {
  private readonly logger = new Logger(ExpirySweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventStore: EventStoreService,
  ) {}

  @Process('sweep')
  async handleExpirySweep(job: Job<{ shopId?: string }>) {
    const shopId = job.data?.shopId || '1';
    this.logger.log(`Starting expiry sweep for shop ${shopId}`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nearExpiryThreshold = new Date(today);
    nearExpiryThreshold.setDate(today.getDate() + 7);

    const candidates = await this.prisma.event.findMany({
      where: {
        shop_id: shopId,
        event_type: {
          in: ['received', 'finished_good_added', 'production_finished'],
        },
        expiry_date: { lte: nearExpiryThreshold },
      },
      select: {
        id: true,
        item_id: true,
        batch_number: true,
        expiry_date: true,
        quantity: true,
        unit_cost: true,
        total_cost: true,
        payload: true,
      },
      orderBy: { expiry_date: 'asc' },
    });

    if (candidates.length === 0) {
      this.logger.log('No near/expired batches found');
      return { processed: 0, expired: 0, alerts: 0 };
    }

    let expiredCount = 0;
    let alertCount = 0;

    for (const batch of candidates) {
      const payload = (batch.payload || {}) as Record<string, any>;
      const itemId =
        batch.item_id || (payload.item_id as string | undefined);
      const quantity = Number(
        batch.quantity ??
          payload.quantity_approved ??
          payload.quantity ??
          payload.actual_quantity_produced ??
          0,
      );

      if (!itemId || quantity <= 0 || !batch.expiry_date) continue;

      const daysLeft = Math.floor(
        (batch.expiry_date.getTime() - today.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysLeft <= 0) {
        const idempotencyKey = `expiry-${batch.id}`;

        try {
          await this.eventStore.appendEvent({
            event_type: 'batch_expired',
            actor_user_id: 'system-expiry-sweep',
            idempotency_key: idempotencyKey,
            batch_number: batch.batch_number || undefined,
            expiry_date: batch.expiry_date,
            waste_reason: 'expired',
            payload: {
              item_id: itemId,
              item_name: payload.item_name,
              quantity,
              unit_cost: Number(batch.unit_cost ?? payload.unit_cost ?? 0),
              total_cost: Number(
                batch.total_cost ??
                  payload.total_cost ??
                  quantity * Number(payload.unit_cost ?? 0),
              ),
              source_event_id: batch.id,
              batch_number: batch.batch_number,
              expiry_date: batch.expiry_date.toISOString(),
              units: payload.units || payload.unit,
            },
          });
          expiredCount += 1;
          this.logger.log(
            `Expired batch recorded: ${quantity} of ${itemId} (source ${batch.id})`,
          );
        } catch (err: any) {
          this.logger.debug(
            `Skip/conflict expiry for ${batch.id}: ${err?.message || err}`,
          );
        }
        continue;
      }

      if (daysLeft <= 7) {
        alertCount += 1;
        try {
          await this.prisma.inventoryProjection.updateMany({
            where: { shop_id: shopId, item_id: itemId },
            data: {
              days_to_expiry_min: daysLeft,
              next_expiry_date: batch.expiry_date,
              updated_at: new Date(),
            },
          });
        } catch {
          // projection may not exist yet
        }

        this.logger.warn(
          `[ALERT] ${quantity} of ${itemId} expires in ${daysLeft} day(s)`,
        );
      }
    }

    this.logger.log(
      `Expiry sweep done — expired events: ${expiredCount}, alerts: ${alertCount}`,
    );

    return {
      processed: candidates.length,
      expired: expiredCount,
      alerts: alertCount,
    };
  }
}