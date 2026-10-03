"use client";

import { useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/utils";

export type InventorySkuOption = {
  itemId: string;
  name: string;
  unit: string;
  availableStock: number;
  category?: string | null;
};

export type InventorySkuPickerProps = {
  items: InventorySkuOption[];
  selectedIds: string[];
  /** multi = checkboxes (CHOICE inventory select); single = radio-style one SKU */
  mode?: "multi" | "single";
  onChange: (nextIds: string[]) => void;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** Optional max height class for the scroll region */
  maxHeightClassName?: string;
};

/**
 * Shared direct inventory-select list — visual parity with Dashboard → Inventory.
 * Does not change FIXED/FG quantity math; selection only.
 */
export function InventorySkuPicker({
  items,
  selectedIds,
  mode = "multi",
  onChange,
  isLoading = false,
  emptyTitle = "No stock items",
  emptyDescription = "Receive goods or produce finished goods to link them here.",
  className,
  maxHeightClassName = "max-h-52",
}: InventorySkuPickerProps) {
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const cat = (row.category ?? "").toLowerCase();
      return (
        row.name.toLowerCase().includes(q) ||
        row.itemId.toLowerCase().includes(q) ||
        cat.includes(q)
      );
    });
  }, [items, query]);

  function toggle(itemId: string) {
    if (mode === "single") {
      onChange(selectedSet.has(itemId) ? [] : [itemId]);
      return;
    }
    if (selectedSet.has(itemId)) {
      onChange(selectedIds.filter((id) => id !== itemId));
    } else {
      onChange([...selectedIds, itemId]);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, SKU, or category…"
          className="pl-9"
          aria-label="Search inventory SKUs"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>
          {selectedIds.length > 0
            ? `${selectedIds.length} selected`
            : "None selected"}
        </span>
        <span>
          {filtered.length}
          {filtered.length !== items.length ? ` of ${items.length}` : ""} shown
        </span>
      </div>

      <div
        className={cn(
          "overflow-y-auto rounded-lg border border-border bg-surface",
          maxHeightClassName,
        )}
      >
        {isLoading && items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            Loading stock…
          </p>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-4">
            <EmptyState
              icon={Package}
              title={query.trim() ? "No matches" : emptyTitle}
              description={
                query.trim()
                  ? "Try another search term."
                  : emptyDescription
              }
            />
          </div>
        ) : (
          <table className="w-full min-w-0 text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-border bg-surface-muted/95 backdrop-blur-sm">
              <tr className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                <th className="w-10 px-3 py-2" scope="col">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Item
                </th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell" scope="col">
                  Category
                </th>
                <th className="px-3 py-2 text-right font-medium" scope="col">
                  Available
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const checked = selectedSet.has(row.itemId);
                const stockLabel = Number.isFinite(row.availableStock)
                  ? `${row.availableStock} ${row.unit}`
                  : `— ${row.unit}`;
                return (
                  <tr
                    key={row.itemId}
                    className={cn(
                      "border-b border-border last:border-b-0 transition-colors",
                      checked ? "bg-primary-50/60" : "hover:bg-surface-muted/80",
                    )}
                  >
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        type={mode === "single" ? "radio" : "checkbox"}
                        name={mode === "single" ? "inventory-sku-picker" : undefined}
                        checked={checked}
                        onChange={() => toggle(row.itemId)}
                        aria-label={`Select ${row.name}`}
                        className="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => toggle(row.itemId)}
                      >
                        <span className="block font-medium text-ink">
                          {row.name}
                        </span>
                        <span className="block text-xs text-ink-faint">
                          {row.itemId}
                        </span>
                      </button>
                    </td>
                    <td className="hidden px-3 py-2.5 align-middle sm:table-cell">
                      {row.category ? (
                        <Badge tone="neutral">
                          {humanize(row.category)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right align-middle tabular-nums text-ink">
                      {stockLabel}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
