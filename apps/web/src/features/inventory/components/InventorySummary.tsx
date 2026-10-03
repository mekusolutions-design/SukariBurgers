// apps/web/src/features/inventory/components/InventorySummary.tsx
"use client";

import { Boxes, PackageX, TimerReset, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrencyCompact } from "@/lib/format/currency";

export type InventoryStatusFilter =
  | "all"
  | "in-stock"
  | "low-stock"
  | "out-of-stock"
  | "near-expiry"
  | "expired";

export interface InventorySummaryData {
  totalItems: number;
  totalValue: number;
  lowOrOutCount: number;
  expiredCount: number;
}

export function InventorySummary({
  data,
  activeStatus,
  onStatusClick,
}: {
  data: InventorySummaryData;
  activeStatus?: string;
  onStatusClick?: (status: InventoryStatusFilter) => void;
}) {
  const cardClass =
    "cursor-pointer transition hover:ring-2 hover:ring-primary-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-xl";

  function wrap(
    status: InventoryStatusFilter,
    node: React.ReactNode,
    isActive: boolean,
  ) {
    if (!onStatusClick) return node;
    return (
      <button
        type="button"
        className={`${cardClass} text-left w-full ${
          isActive ? "ring-2 ring-primary-400" : ""
        }`}
        onClick={() => onStatusClick(status)}
      >
        {node}
      </button>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {wrap(
        "all",
        <StatCard
          label="Tracked items"
          value={String(data.totalItems)}
          icon={Boxes}
        />,
        !activeStatus || activeStatus === "all",
      )}
      {wrap(
        "all",
        <StatCard
          label="Total stock value"
          value={formatCurrencyCompact(data.totalValue)}
          icon={Wallet}
        />,
        false,
      )}
      {wrap(
        "low-stock",
        <StatCard
          label="Low / out of stock"
          value={String(data.lowOrOutCount)}
          icon={PackageX}
        />,
        activeStatus === "low-stock" || activeStatus === "out-of-stock",
      )}
      {wrap(
        "expired",
        <StatCard
          label="Expired items"
          value={String(data.expiredCount)}
          icon={TimerReset}
        />,
        activeStatus === "expired",
      )}
    </div>
  );
}
