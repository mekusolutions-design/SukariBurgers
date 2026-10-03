// apps/api/src/modules/recipe/dto/update-recipe.dto.ts
import { z } from 'zod';

export const UpdateRecipeSchema = z.object({
  item_name: z.string().min(1).optional(),
  standard_yield: z.number().positive().optional(),
  unit: z.string().min(1).optional(),
  notes: z.string().optional(),
  category: z.string().min(1).nullable().optional(),
  recipe_type: z
    .enum([
      'SINGLE_OUTPUT',
      'PORTION_OUTPUT',
      'MULTI_OUTPUT',
      'ASSEMBLY',
      'CONVERSION',
      'CO_PRODUCT',
      'SUB_RECIPE',
    ])
    .optional(),
  yield_quantity: z.number().positive().optional(),
  yield_unit: z.string().min(1).optional(),
  yield_basis: z.enum(['BATCH', 'UNIT']).optional(),
  payload: z.record(z.string(), z.any()).optional(),
});

export type UpdateRecipeDto = z.infer<typeof UpdateRecipeSchema>;
