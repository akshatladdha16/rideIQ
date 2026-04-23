"use client";

import { useEffect, useMemo, useState } from "react";

import { InvoiceDetail } from "@/components/invoice-detail";
import { InvoiceTable } from "@/components/invoice-table";
import { StatsCards } from "@/components/stats-cards";
import { TopNav } from "@/components/top-nav";
import type { DashboardStats, InvoiceRecord } from "@/lib/types";

const EMPTY_STATS: DashboardStats = {
  totalSpend: 0,
  totalRides: 0,
  avgFare: 0,
  totalGstPaid: 0,
};

export default function DashboardPage(): JSX.Element {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [paymentModes, setPaymentModes] = useState<string[]>([]);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ month: "", payment: "all", query: "" });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.month) {
      params.set("month", filters.month);
    }
    if (filters.payment && filters.payment !== "all") {
      params.set("payment", filters.payment);
    }
    if (filters.query.trim()) {
      params.set("query", filters.query.trim());
    }
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let isMounted = true;

    async function loadData(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/invoices${queryString ? `?${queryString}` : ""}`);
        const payload = (await res.json()) as {
          error?: string;
          invoices?: InvoiceRecord[];
          stats?: DashboardStats;
          paymentModes?: string[];
        };

        if (!res.ok) {
          throw new Error(payload.error ?? "Failed to fetch invoices");
        }

        if (!isMounted) {
          return;
        }

        setInvoices(payload.invoices ?? []);
        setStats(payload.stats ?? EMPTY_STATS);
        setPaymentModes(payload.paymentModes ?? []);
      } catch (err: unknown) {
        if (!isMounted) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to fetch invoices");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [queryString]);

  return (
    <main className="min-h-screen bg-muted/30">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">RideIQ Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Analyze your ride history with filters, tax breakdowns, and quick insights.
          </p>
        </div>

        <StatsCards stats={stats} />

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <InvoiceTable
            invoices={invoices}
            paymentModes={paymentModes}
            filters={filters}
            onFiltersChange={setFilters}
            onSelectInvoice={setSelectedInvoice}
          />
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading invoices...</p>}

        <InvoiceDetail
          invoice={selectedInvoice}
          open={!!selectedInvoice}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedInvoice(null);
            }
          }}
        />
      </section>
    </main>
  );
}
