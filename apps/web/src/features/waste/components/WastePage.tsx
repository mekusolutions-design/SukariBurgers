// apps/web/src/features/waste/components/WastePage.tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, PackageMinus } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";

import { useWasteDashboard } from "../hooks/use-waste-dashboard";
import { wasteApi } from "../api";
import { recordWasteSchema, type RecordWasteInput } from "../schema";
import { WASTE_CAUSE_LABELS } from "../constants";
import { WasteSummaryCards } from "./WasteSummaryCards";
import { WasteByCauseTable } from "./WasteByCauseTable";
import { TopWastedItemsTable } from "./TopWastedItemsTable";
import { WasteCauseBadge } from "./WasteCauseBadge";
import { WasteSkeleton } from "./WasteSkeleton";
import { PeriodFilter } from "@/features/dashboard/components/PeriodFilter";
import { formatCurrency } from "@/lib/format/currency";
import { formatQuantity } from "@/lib/format/numbers";
import { formatRelativeTime } from "@/lib/format/dates";
import { routes } from "@/lib/routes";
import { useToast } from "@/providers/ToastProvider";
import { ApiError } from "@/lib/api/errors";

function LogWasteModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState({
    item_id: "",
    quantity: "",
    waste_reason: "expired",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (input: RecordWasteInput) => wasteApi.recordWaste(input),
    onSuccess: () => {
      toast({ title: "Waste recorded", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["waste"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onOpenChange(false);
      setForm({
        item_id: "",
        quantity: "",
        waste_reason: "expired",
        notes: "",
      });
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't record this."),
  });

  function handleSubmit() {
    const result = recordWasteSchema.safeParse(form);
    if (!result.success) {
      setError(
        result.error.issues[0]?.message ?? "Check the form and try again.",
      );
      return;
    }
    setError(null);
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Log waste"
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleSubmit}
            loading={mutation.isPending}
          >
            Record waste
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger" title={error} /> : null}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Item ID / SKU
          </label>
          <Input
            value={form.item_id}
            onChange={(e) => setForm({ ...form, item_id: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Quantity
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Cause
            </label>
            <Select
              value={form.waste_reason}
              onValueChange={(v) => setForm({ ...form, waste_reason: v })}
              options={Object.entries(WASTE_CAUSE_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Notes (optional)
          </label>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
          />
        </div>
      </div>
    </Modal>
  );
}

export function WastePage({ shopId }: { shopId: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { summary, events, period, setPeriod, setRange } =
    useWasteDashboard(shopId);

  const writeOff = useMutation({
    mutationFn: () => wasteApi.writeOffExpired(shopId),
    onSuccess: (res) => {
      toast({
        title: "Expired write-off",
        description: res.message,
        variant: "success",
      });
      void queryClient.invalidateQueries({ queryKey: ["waste"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({
        queryKey: ["inventory", "summary"],
      });
    },
    onError: (err) => {
      toast({
        title: "Write-off failed",
        description: err instanceof ApiError ? err.message : "Try again",
        variant: "danger",
      });
    },
  });

  if (summary.isPending) return <WasteSkeleton />;

  if (summary.isError) {
    return (
      <ErrorState
        title="Couldn't load waste data"
        description={summary.error.message}
        onRetry={summary.refetch}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Waste"
        description="Track spoilage, prep errors, and write-offs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodFilter
              value={period}
              onPresetChange={setPeriod}
              onRangeChange={setRange}
            />
            <Button
              variant="secondary"
              onClick={() => writeOff.mutate()}
              loading={writeOff.isPending}
            >
              Write off expired stock
            </Button>
            <Button variant="danger" onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" /> Log waste
            </Button>
          </div>
        }
      />

      <WasteSummaryCards summary={summary.data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WasteByCauseTable byCause={summary.data.byCause} />
        <TopWastedItemsTable shopId={shopId} items={summary.data.topItems} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent waste events</CardTitle>
        </CardHeader>
        {!events.data || events.data.items.length === 0 ? (
          <EmptyState icon={PackageMinus} title="No waste events yet" />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Quantity
                </TableHeaderCell>
                <TableHeaderCell>Cause</TableHeaderCell>
                <TableHeaderCell>Batch</TableHeaderCell>
                <TableHeaderCell className="text-right">Value</TableHeaderCell>
                <TableHeaderCell>Reported by</TableHeaderCell>
                <TableHeaderCell>When</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {events.data.items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link
                      href={routes.wasteEvent(shopId, event.id)}
                      className="font-medium text-primary-700 hover:underline"
                    >
                      {event.itemName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(event.quantity, event.unit)}
                  </TableCell>
                  <TableCell>
                    <WasteCauseBadge cause={event.cause} />
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {event.batchNumber ? (
                      <Link
                        href={routes.traceSearch(shopId, {
                          batchNumber: event.batchNumber,
                        })}
                        className="hover:underline"
                      >
                        {event.batchNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(event.value)}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {event.reportedBy}
                  </TableCell>
                  <TableCell className="text-ink-faint">
                    {formatRelativeTime(event.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <LogWasteModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
