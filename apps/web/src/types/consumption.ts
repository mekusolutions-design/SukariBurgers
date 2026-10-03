export interface ConsumptionSummary {
  totalConsumedValue: number;
  periodRevenue: number;
  topProducts: TopConsumedProduct[];
  topMenuItems: TopConsumedMenuItem[];
}

export interface TopConsumedProduct {
  itemId: string;
  name: string;
  unit: string;
  quantityConsumed: number;
  valueConsumed: number;
}

export interface TopConsumedMenuItem {
  menuItemId: string;
  name: string;
  unitsSold: number;
  revenue: number;
  foodCostPercent: number | null;
}

export interface ConsumptionAlert {
  id: string;
  itemId: string;
  itemName: string;
  type: "unusual_spike" | "unusual_drop" | "negative_margin";
  message: string;
  createdAt: string;
}
