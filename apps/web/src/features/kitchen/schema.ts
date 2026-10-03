// apps/web/src/features/kitchen/schema.ts
import { z } from "zod";

export const startProductionSchema = z.object({
  recipe_id: z.string().min(1, "Recipe ID is required"),
  batch_size: z.coerce.number().positive("Batch size must be positive"),
});

export type StartProductionInput = z.infer<typeof startProductionSchema>;

export const closingStockSubmissionSchema = z.object({
  entries: z
    .array(
      z.object({
        itemId: z.string().min(1),
        countedQuantity: z.number().finite(),
      }),
    )
    .min(1),
  shiftLabel: z.string().optional(),
  notes: z.string().optional(),
});

export type ClosingStockSubmission = z.infer<
  typeof closingStockSubmissionSchema
>;

export const productionLineSchema = z.object({
  itemId: z.string().min(1),
  itemName: z.string().optional(),
  standardQuantity: z.coerce.number().finite().optional(),
  actualQuantity: z.coerce.number().finite(),
  unit: z.string().optional(),
  unitCost: z.coerce.number().min(0).optional(),
});

export const finishProductionSchema = z.object({
  productionId: z.string().min(1),
  actualYield: z.coerce.number().positive("Actual yield must be positive"),
  wasteQuantity: z.coerce.number().nonnegative().optional().default(0),
  wasteReason: z.string().optional(),
  unitCost: z.coerce.number().min(0).optional().default(0),
  batchNumber: z.string().optional(),
  inputs: z.array(productionLineSchema).optional(),
  outputs: z.array(productionLineSchema).optional(),
});

export type FinishProductionInput = z.infer<typeof finishProductionSchema>;
export type ProductionLineInput = z.infer<typeof productionLineSchema>;
