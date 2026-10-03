// apps/web/src/features/inventory/components/InventoryTable.tsx
"use client";

import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Package } from "lucide-react";
import { formatCurrency } from "@/lib/format/currency";
import { formatQuantity } from "@/lib/format/numbers";
import { formatDateTime } from "@/lib/format/dates";
import { humanize } from "@/lib/utils";
import { stockStatusFor, type InventoryItem } from "../types";
import { StockStatusBadge } from "./StockStatusBadge";

function formatDaysToExpiry(days: number | null | undefined): string {
  if (days == null || Number.isNaN(Number(days))) return "—";
  const d = Number(days);
  if (d < 0) return `Expired ${Math.abs(Math.floor(d))}d ago`;
  if (d === 0) return "Expires today";
  if (d === 1) return "1 day";
  return `${Math.floor(d)} days`;
}

export function InventoryTable({
  items,
  isLoading = false,
}: {
  items: InventoryItem[];
  shopId?: string;
  isLoading?: boolean;
}) {
  const list = items ?? [];

  if (isLoading && list.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-muted">
        Loading stock…
      </p>
    );
  }

  if (list.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No stock rows"
        description="Receive goods or adjust filters to see inventory."
      />
    );
  }

  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeaderCell>Item</TableHeaderCell>
          <TableHeaderCell>Category</TableHeaderCell>
          <TableHeaderCell className="text-right">Available</TableHeaderCell>
          <TableHeaderCell className="text-right">Reorder point</TableHeaderCell>
          <TableHeaderCell className="text-right">Unit cost</TableHeaderCell>
          <TableHeaderCell className="text-right">Value</TableHeaderCell>
          <TableHeaderCell className="text-right">Days to expiry</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Last updated</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {list.map((item) => {
          const status = stockStatusFor(item);
          const days = item.daysToExpiryMin;
          return (
            <TableRow key={item.itemId}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell className="text-ink-muted">
                {humanize(item.category || "general")}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQuantity(item.availableStock, item.unit)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-ink-muted">
                {formatQuantity(item.reorderPoint, item.unit)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.costMissing ? (
                  <span className="text-amber-600" title="Receive goods with unit cost to set WAC">
                    Cost missing
                  </span>
                ) : item.unitCost > 0 ? (
                  formatCurrency(item.unitCost)
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.costMissing ? (
                  <span className="text-amber-600">—</span>
                ) : (
                  formatCurrency(item.totalValue)
                )}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${
                  days != null && days < 0
                    ? "font-medium text-red-600"
                    : days != null && days <= 3
                      ? "font-medium text-amber-600"
                      : "text-ink-muted"
                }`}
              >
                {formatDaysToExpiry(days)}
              </TableCell>
              <TableCell>
                <StockStatusBadge status={status} />
              </TableCell>
              <TableCell className="text-ink-faint">
                {item.updatedAt ? formatDateTime(item.updatedAt) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
