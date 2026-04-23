import { getSupabaseAdminClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { DashboardStats, InvoiceRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to fetch invoices";
}

function parseMonth(monthParam: string | null): { from: string; to: string } | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    return null;
  }
  const [yearStr, monthStr] = monthParam.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function computeStats(invoices: InvoiceRecord[]): DashboardStats {
  const totalSpend = invoices.reduce((sum, inv) => sum + (inv.total_fare ?? 0), 0);
  const totalRides = invoices.length;
  const avgFare = totalRides ? totalSpend / totalRides : 0;
  const totalGstPaid = invoices.reduce(
    (sum, inv) =>
      sum +
      (inv.cgst_ride ?? 0) +
      (inv.sgst_ride ?? 0) +
      (inv.cgst_platform ?? 0) +
      (inv.sgst_platform ?? 0),
    0
  );

  return {
    totalSpend: Number(totalSpend.toFixed(2)),
    totalRides,
    avgFare: Number(avgFare.toFixed(2)),
    totalGstPaid: Number(totalGstPaid.toFixed(2)),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    logger.info("api.invoices", "Invoices request received");
    const { searchParams } = new URL(request.url);
    const month = parseMonth(searchParams.get("month"));
    const payment = searchParams.get("payment");
    const query = searchParams.get("query")?.trim().toLowerCase();

    logger.debug("api.invoices", "Parsed request filters", {
      month: month?.from ? `${month.from}:${month.to}` : null,
      payment,
      query,
    });

    const supabase = getSupabaseAdminClient();

    let requestBuilder = supabase
      .from("invoices")
      .select("*")
      .order("ride_date", { ascending: false });

    if (month) {
      requestBuilder = requestBuilder.gte("ride_date", month.from).lt("ride_date", month.to);
    }

    if (payment && payment !== "all") {
      requestBuilder = requestBuilder.eq("payment_mode", payment);
    }

    const { data, error } = await requestBuilder;

    if (error) {
      logger.error("api.invoices", "Supabase query failed", {
        error: error.message,
      });
      throw new Error(error.message);
    }

    const rows = (data ?? []) as InvoiceRecord[];
    logger.debug("api.invoices", "Fetched invoice rows", { count: rows.length });

    const filtered = query
      ? rows.filter((inv) => {
          const pickup = inv.pickup_area?.toLowerCase() ?? "";
          const dropoff = inv.dropoff_area?.toLowerCase() ?? "";
          const pickupAddress = inv.pickup?.toLowerCase() ?? "";
          const dropoffAddress = inv.dropoff?.toLowerCase() ?? "";

          return (
            pickup.includes(query) ||
            dropoff.includes(query) ||
            pickupAddress.includes(query) ||
            dropoffAddress.includes(query)
          );
        })
      : rows;

    logger.debug("api.invoices", "Computed filtered rows", {
      count: filtered.length,
    });

    const paymentModes = Array.from(
      new Set(rows.map((inv) => inv.payment_mode).filter((mode): mode is string => !!mode))
    ).sort((a, b) => a.localeCompare(b));

    return Response.json({
      invoices: filtered,
      stats: computeStats(filtered),
      paymentModes,
    });
  } catch (error: unknown) {
    logger.error("api.invoices", "Invoices request failed", {
      error: getErrorMessage(error),
    });
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
