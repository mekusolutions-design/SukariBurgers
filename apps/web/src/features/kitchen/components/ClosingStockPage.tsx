"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullPageSpinner } from "@/components/feedback/FullPageSpinner";
import { routes } from "@/lib/routes";
import { useClosingStock } from "../hooks/use-closing-stock";
import { ClosingStockForm } from "./ClosingStockForm";
import { useToast } from "@/providers/ToastProvider";

export function ClosingStockPage({ shopId }: { shopId: string }) {
  const { form, submit } = useClosingStock(shopId);
  const { toast } = useToast();

  if (form.isPending) {
    return <FullPageSpinner label="Loading closing stock…" />;
  }

  if (form.isError) {
    return (
      <ErrorState
        title="Couldn't load closing stock"
        description={form.error.message}
        onRetry={form.refetch}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={routes.kitchen(shopId)}
        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to kitchen
      </Link>

      <PageHeader
        title="Closing stock"
        description="Count end-of-shift stock to flag variance early."
      />

      <Card className="p-5">
        <ClosingStockForm
          entries={form.data ?? []}
          error={submit.error}
          isSubmitting={submit.isPending}
          onSubmit={(submission) =>
            submit.mutate(submission, {
              onSuccess: () =>
                toast({
                  title: "Closing stock submitted",
                  variant: "success",
                }),
            })
          }
        />
      </Card>
    </div>
  );
}
