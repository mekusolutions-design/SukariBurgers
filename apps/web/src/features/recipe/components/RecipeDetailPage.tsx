// apps/web/src/features/recipes/components/RecipeDetailPage.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullPageSpinner } from "@/components/feedback/FullPageSpinner";
import { RoleGate } from "@/components/layout/RoleGate";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/Table";
import { routes } from "@/lib/routes";
import { formatQuantity } from "@/lib/format/numbers";
import { formatCurrency } from "@/lib/format/currency";
import { useToast } from "@/providers/ToastProvider";
import { ApiError } from "@/lib/api/errors";
import { RECIPE_UNITS } from "../constants";
import { updateRecipeSchema } from "../schema";
import { useRecipe } from "../hooks/use-recipe";
import { useUpdateRecipe } from "../hooks/use-update-recipe";

export function RecipeDetailPage({
  shopId,
  recipeId,
}: {
  shopId: string;
  recipeId: string;
}) {
  const recipe = useRecipe(recipeId);
  const update = useUpdateRecipe(shopId, recipeId);
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [itemName, setItemName] = useState("");
  const [standardYield, setStandardYield] = useState("");
  const [unit, setUnit] = useState("portion");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (recipe.isPending) {
    return <FullPageSpinner label="Loading recipe…" />;
  }

  if (recipe.isError) {
    return (
      <ErrorState
        title="Couldn't load this recipe"
        description={recipe.error.message}
        onRetry={recipe.refetch}
      />
    );
  }

  const data = recipe.data;
  const ingredients = data.ingredients ?? [];
  const outputs = data.outputs ?? [];

  function startEdit() {
    setItemName(data.name);
    setStandardYield(String(data.standardYield));
    setUnit(data.unit || "portion");
    setNotes(data.notes ?? "");
    setFormError(null);
    setEditing(true);
  }

  function handleSave() {
    // Prevent double submission
    if (update.isPending) return;

    const parsed = updateRecipeSchema.safeParse({
      itemName,
      standardYield,
      unit,
      notes: notes || null,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }

    setFormError(null);
    update.mutate(parsed.data, {
      onSuccess: () => {
        toast({ title: "Recipe updated", variant: "success" });
        setEditing(false);
      },
      onError: (err) => {
        setFormError(
          err instanceof ApiError ? err.message : "Could not update recipe.",
        );
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={routes.recipes(shopId)}
        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to recipes
      </Link>

      <PageHeader
        title={data.name}
        description={`Finished SKU ${data.itemId} · yield ${data.standardYield} ${data.unit}${
          data.recipeType ? ` · ${data.recipeType.replace(/_/g, " ").toLowerCase()}` : ""
        }`}
        actions={
          <RoleGate allow={["ADMIN", "MANAGER"]}>
            {editing ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={update.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  loading={update.isPending}
                  disabled={update.isPending}
                >
                  Save changes
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={startEdit}>
                Edit recipe
              </Button>
            )}
          </RoleGate>
        }
      />

      {formError ? <Alert tone="danger" title={formError} /> : null}

      {editing ? (
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">
                Finished item name
              </label>
              <Input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">
                Finished item ID / SKU
              </label>
              <Input value={data.itemId} disabled />
              <p className="mt-1 text-xs text-ink-faint">
                SKU cannot be changed after create (links inventory & production).
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">
                Standard yield
              </label>
              <Input
                type="number"
                min="0.001"
                step="any"
                value={standardYield}
                onChange={(e) => setStandardYield(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">
                Yield unit
              </label>
              <Select
                value={unit}
                onValueChange={setUnit}
                options={RECIPE_UNITS.map((u) => ({
                  value: u.value,
                  label: u.label,
                }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-ink-muted">
                Notes
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Outputs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {outputs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              No outputs recorded. Default is finished SKU{" "}
              <span className="font-medium text-ink">{data.itemId}</span>.
            </p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>SKU</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Standard qty
                  </TableHeaderCell>
                  <TableHeaderCell>Unit</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Unit weight
                  </TableHeaderCell>
                  <TableHeaderCell>Default</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {outputs.map((out, i) => (
                  <TableRow key={out.id ?? `${out.itemId}-${i}`}>
                    <TableCell className="font-medium">{out.itemId}</TableCell>
                    <TableCell>{out.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {out.standardQuantity != null
                        ? formatQuantity(out.standardQuantity, out.unit)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-ink-muted">{out.unit}</TableCell>
                    <TableCell className="text-right tabular-nums text-ink-muted">
                      {out.unitWeight != null
                        ? `${out.unitWeight}${out.weightUnit ? ` ${out.weightUnit}` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {out.isDefault ? (
                        <span className="text-xs font-medium text-primary-700">
                          Default
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-ink-muted">Batch cost</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums">
            {data.batchCost != null && data.batchCost > 0
              ? formatCurrency(data.batchCost)
              : data.costMissing
                ? "Cost missing"
                : "—"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-muted">
            Cost per yield unit ({data.unit})
          </p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums">
            {data.stdUnitCost != null && data.stdUnitCost > 0
              ? formatCurrency(data.stdUnitCost)
              : "—"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-muted">Standard yield</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums">
            {formatQuantity(data.standardYield, data.unit)}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingredients (raw materials)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ingredients.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              No ingredients on this recipe yet.
            </p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Raw SKU</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Qty / batch
                  </TableHeaderCell>
                  <TableHeaderCell>Unit</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Unit cost
                  </TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Line cost
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {ingredients.map((ing, i) => (
                  <TableRow key={`${ing.rawItemId}-${i}`}>
                    <TableCell className="font-medium">
                      <Link
                        href={routes.traceSearch(shopId, {
                          itemId: ing.rawItemId,
                        })}
                        className="text-primary-700 hover:underline"
                      >
                        {ing.rawItemId}
                      </Link>
                    </TableCell>
                    <TableCell>{ing.rawItemName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(ing.quantityPerUnit, ing.unit)}
                    </TableCell>
                    <TableCell className="text-ink-muted">{ing.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ing.costMissing ? (
                        <span className="text-amber-600">Cost missing</span>
                      ) : ing.unitCost != null && ing.unitCost > 0 ? (
                        formatCurrency(ing.unitCost)
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ing.lineCost != null && ing.lineCost > 0
                        ? formatCurrency(ing.lineCost)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!editing && data.notes ? (
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Notes
          </p>
          <p className="mt-1 text-sm text-ink">{data.notes}</p>
        </Card>
      ) : null}
    </div>
  );
}