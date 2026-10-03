import { DollarSign, TrendingDown } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { formatCurrencyCompact } from "@/lib/format/currency";
import { foodCostPercent, foodCostStatus } from "@/lib/kpis/food-cost";
import { formatPercent } from "@/lib/format/percent";
import type { ConsumptionSummary } from "../types";

export function ConsumptionSummaryCards({ summary }: { summary: ConsumptionSummary }) {
  const ratio = foodCostPercent(summary.totalConsumedValue, summary.periodRevenue);
  const status = foodCostStatus(ratio);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <KpiCard label="Total consumed value" value={formatCurrencyCompact(summary.totalConsumedValue)} icon={DollarSign} />
      <KpiCard
        label="Consumption as % of revenue"
        value={formatPercent(ratio)}
        icon={TrendingDown}
        tone={status === "over" ? "danger" : status === "watch" ? "warning" : "success"}
      />
    </div>
  );
}
