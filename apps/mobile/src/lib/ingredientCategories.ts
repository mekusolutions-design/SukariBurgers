// apps/mobile/src/lib/ingredientCategories.ts
// Canonical categories shared with the web app and Nest API.
// Keep the labels and order aligned with:
// - apps/web/src/lib/catalog/ingredient-categories.ts
// - apps/api/src/common/constants/ingredient-categories.ts

export type IngredientCategoryGroup = {
  group: string;
  items: string[];
};

export const INGREDIENT_CATEGORY_GROUPS: IngredientCategoryGroup[] = [
  {
    group: 'Food ingredients',
    items: [
      'Meat & Poultry',
      'Fish & Seafood',
      'Dairy & Eggs',
      'Fruits & Vegetables',
      'Grains, Cereals & Pulses',
      'Baking & Bakery',
      'Nuts, Seeds & Alternatives',
      'Herbs, Spices & Seasonings',
      'Oils, Sauces & Condiments',
      'Sweeteners & Food Ingredients',
      'Frozen & Prepared Foods',
    ],
  },
  {
    group: 'Drinks & ops',
    items: [
      'Beverages',
      'Alcohol & Bar',
      'Packaging & Consumables',
      'Cleaning, Service & Equipment',
    ],
  },
];

// Keep this flat list in the exact canonical order used by web and Nest.
export const INGREDIENT_CATEGORIES: string[] = [
  'Meat & Poultry',
  'Fish & Seafood',
  'Dairy & Eggs',
  'Fruits & Vegetables',
  'Grains, Cereals & Pulses',
  'Baking & Bakery',
  'Nuts, Seeds & Alternatives',
  'Herbs, Spices & Seasonings',
  'Oils, Sauces & Condiments',
  'Sweeteners & Food Ingredients',
  'Beverages',
  'Alcohol & Bar',
  'Frozen & Prepared Foods',
  'Packaging & Consumables',
  'Cleaning, Service & Equipment',
];

export const DEFAULT_INGREDIENT_CATEGORY = 'Packaging & Consumables';
