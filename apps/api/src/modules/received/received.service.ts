// apps/api/src/modules/received/received.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventStoreService } from '../../core/event-store.service';
import { IdempotencyService } from '../../core/idempotency.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteService } from '../waste/waste.service';
import { normalizeIngredientCategory } from '../../common/constants/ingredient-categories';
import { normalizeSku } from '../../common/utils/sku.util';
import type { ReceiveGoodsDto } from './dto/receive-goods.dto';

interface IdempotencyResult {
  isReplay: boolean;
  existing: { id: string; payload?: unknown } | null;
}

@Injectable()
export class ReceivedService {
  private readonly logger = new Logger(ReceivedService.name);

  constructor(
    private readonly eventStore: EventStoreService,
    private readonly idempotencyService: IdempotencyService,
    private readonly prisma: PrismaService,
    private readonly wasteService: WasteService,
  ) {}

  async receiveGoods(dto: ReceiveGoodsDto, actorUserId: string) {
    const itemId = normalizeSku(dto.item_id);
    if (!itemId) {
      throw new BadRequestException('item_id is required');
    }

    const approvedQuantity = dto.quantity_approved ?? dto.quantity;
    const rejectedQuantity = dto.quantity_rejected ?? 0;
    const finalTotalCost = dto.total_cost ?? approvedQuantity * dto.unit_cost;
    const category =
      normalizeIngredientCategory(dto.category) ?? dto.category?.trim();

    const idempotencyKey = `receive-${itemId}-${dto.batch_number}-${dto.date_received}`;

    const result = (await this.idempotencyService.enforce(idempotencyKey, {
      ...dto,
      item_id: itemId,
    })) as IdempotencyResult;

    if (result.isReplay) {
      return {
        success: true,
        eventId: result.existing?.id,
        message: 'Already processed (idempotent replay)',
      };
    }

    await this.ensureItemExists(itemId, dto.item_name, dto.units, category);

    const event = await this.eventStore.appendEvent({
      event_type: 'received',
      actor_user_id: actorUserId,
      idempotency_key: idempotencyKey,
      batch_number: dto.batch_number,
      expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : undefined,
      waste_reason: dto.waste_reason,
      waste_photo_url: dto.waste_photo_url,
      item_id: itemId,
      quantity: approvedQuantity,
      unit_cost: dto.unit_cost,
      total_cost: finalTotalCost,
      payload: {
        ...(dto.payload && typeof dto.payload === 'object' ? dto.payload : {}),
        item_id: itemId,
        item_name: dto.item_name,
        units: dto.units,
        category: category ?? null,
        quantity: dto.quantity,
        quantity_approved: approvedQuantity,
        quantity_rejected: rejectedQuantity,
        date_received: dto.date_received,
        expiry_date: dto.expiry_date,
        unit_cost: dto.unit_cost,
        total_cost: finalTotalCost,
        supplier_name: dto.supplier_name,
        supplier_number: dto.supplier_number,
        supplier_id: dto.supplier_id,
        approved_by: dto.approved_by,
        batch_number: dto.batch_number,
        reference: dto.reference,
        waste_reason: dto.waste_reason,
        waste_photo_url: dto.waste_photo_url,
      },
    });

    if (rejectedQuantity > 0) {
      await this.wasteService.recordWaste(
        {
          module_source: 'received',
          item_id: itemId,
          item_name: dto.item_name,
          batch_number: dto.batch_number,
          quantity_wasted: rejectedQuantity,
          unit_of_measure: dto.units,
          unit_cost: dto.unit_cost,
          total_waste_value: rejectedQuantity * dto.unit_cost,
          waste_type: 'quality_reject',
          waste_reason: dto.waste_reason || 'Rejected on receipt',
          root_cause: 'external',
          severity: rejectedQuantity > 20 ? 'high' : 'medium',
          photos: dto.waste_photo_url ? [dto.waste_photo_url] : [],
        },
        actorUserId,
      );
    }

    this.logger.log(
      `GRN: ${approvedQuantity} ${dto.units} of ${dto.item_name}` +
        (category ? ` [${category}]` : ''),
    );

    return {
      success: true,
      eventId: event.id,
      message:
        rejectedQuantity > 0
          ? 'Goods received; rejected quantity recorded as waste'
          : 'Goods received successfully',
    };
  }

  private async ensureItemExists(
    itemId: string,
    itemName: string,
    unit: string,
    category?: string,
  ) {
    const id = normalizeSku(itemId);
    if (!id) {
      throw new BadRequestException('item_id is required');
    }

    const existing = await this.prisma.item.findUnique({
      where: { item_id: id },
    });

    const normalizedCategory =
      (normalizeIngredientCategory(category) ?? category?.trim()) || undefined;

    if (!existing) {
      if (!normalizedCategory) {
        throw new BadRequestException(
          'Category is required when creating a new item on receive',
        );
      }

      await this.prisma.item.create({
        data: {
          item_id: id,
          name: itemName,
          unit: unit || 'units',
          category: normalizedCategory,
        },
      });

      this.logger.log(
        `Auto-created Item: ${id} - ${itemName} (${normalizedCategory})`,
      );
      return;
    }

    const data: {
      name?: string;
      unit?: string;
      category?: string;
    } = {};

    if (itemName && itemName !== existing.name) {
      data.name = itemName;
    }
    if (unit && unit !== existing.unit) {
      data.unit = unit;
    }
    if (
      normalizedCategory &&
      (!existing.category ||
        existing.category === 'General' ||
        existing.category !== normalizedCategory)
    ) {
      data.category = normalizedCategory;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.item.update({
        where: { item_id: id },
        data,
      });
    }
  }
}
