import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

import { generateEmbedding } from "@/lib/embeddings";
import {
  getSupabaseAdminClient,
  SAFE_SQL_INTENTS,
  type SqlIntent,
} from "@/lib/supabase";
import { type InvoiceChunkMatch, type InvoiceRecord } from "@/lib/types";

const SYSTEM_PROMPT = `You are RideIQ, an intelligent analyst for Rapido ride invoices. You have access to the user's complete invoice history.

Rules:
- Use vector_search for semantic and qualitative questions (locations, captains, vibes)
- Use sql_query for numbers, totals, averages, rankings, and breakdowns
- Use get_invoice_detail when the user references a specific ride ID
- Always format currency as rupee symbol followed by number with two decimals
- When showing multiple results use markdown tables
- Be concise and friendly, you are a personal finance assistant for commutes
- If you use sql_query, always state what the query is computing before showing results`;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isSqlIntent(intent: string): intent is SqlIntent {
  return (SAFE_SQL_INTENTS as readonly string[]).includes(intent);
}

async function fetchInvoicesForAnalytics(): Promise<InvoiceRecord[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("invoices").select("*");

  if (error) {
    throw new Error(`Failed to fetch invoices: ${error.message}`);
  }

  return (data ?? []) as InvoiceRecord[];
}

const vectorSearchTool = tool(
  async ({ query }) => {
    const supabase = getSupabaseAdminClient();
    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc("match_invoice_chunks", {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 5,
    });

    if (error) {
      throw new Error(`vector_search failed: ${error.message}`);
    }

    return {
      query,
      results: ((data ?? []) as InvoiceChunkMatch[]).map((row) => ({
        invoice_id: row.invoice_id,
        chunk_text: row.chunk_text,
        similarity: round2(row.similarity),
        metadata: row.metadata,
      })),
    };
  },
  {
    name: "vector_search",
    description:
      "Use for semantic and qualitative search over invoices (routes, captains, context).",
    schema: z.object({
      query: z.string().min(3),
    }),
  }
);

const sqlQueryTool = tool(
  async ({ intent }) => {
    if (!isSqlIntent(intent)) {
      return {
        error: "Unsupported sql_query intent",
        available_intents: SAFE_SQL_INTENTS,
      };
    }

    const invoices = await fetchInvoicesForAnalytics();

    switch (intent) {
      case "total_spend": {
        const total = round2(
          invoices.reduce((sum, inv) => sum + (inv.total_fare ?? 0), 0)
        );
        return {
          intent,
          sql: "SELECT SUM(total_fare) AS total FROM invoices",
          rows: [{ total }],
        };
      }
      case "ride_count": {
        return {
          intent,
          sql: "SELECT COUNT(*) AS count FROM invoices",
          rows: [{ count: invoices.length }],
        };
      }
      case "avg_fare": {
        const fares = invoices
          .map((inv) => inv.total_fare)
          .filter((fare): fare is number => fare !== null);
        const avg = fares.length
          ? round2(fares.reduce((a, b) => a + b, 0) / fares.length)
          : 0;
        return {
          intent,
          sql: "SELECT ROUND(AVG(total_fare)::numeric, 2) AS avg FROM invoices",
          rows: [{ avg }],
        };
      }
      case "avg_fare_per_km": {
        const ratios = invoices
          .filter((inv) => (inv.distance_km ?? 0) > 0 && inv.total_fare !== null)
          .map((inv) => (inv.total_fare as number) / (inv.distance_km as number));
        const avg_per_km = ratios.length
          ? round2(ratios.reduce((a, b) => a + b, 0) / ratios.length)
          : 0;
        return {
          intent,
          sql: "SELECT ROUND(AVG(total_fare / NULLIF(distance_km,0))::numeric, 2) AS avg_per_km FROM invoices",
          rows: [{ avg_per_km }],
        };
      }
      case "total_gst": {
        const total_gst = round2(
          invoices.reduce(
            (sum, inv) =>
              sum +
              (inv.cgst_ride ?? 0) +
              (inv.sgst_ride ?? 0) +
              (inv.cgst_platform ?? 0) +
              (inv.sgst_platform ?? 0),
            0
          )
        );
        return {
          intent,
          sql: "SELECT ROUND(SUM(cgst_ride + sgst_ride + cgst_platform + sgst_platform)::numeric, 2) AS total_gst FROM invoices",
          rows: [{ total_gst }],
        };
      }
      case "by_month": {
        const map = new Map<string, { month: string; rides: number; spend: number }>();
        for (const inv of invoices) {
          if (!inv.ride_date) {
            continue;
          }
          const month = inv.ride_date.slice(0, 7);
          const existing = map.get(month) ?? { month, rides: 0, spend: 0 };
          existing.rides += 1;
          existing.spend += inv.total_fare ?? 0;
          map.set(month, existing);
        }

        const rows = Array.from(map.values())
          .sort((a, b) => a.month.localeCompare(b.month))
          .map((row) => ({ ...row, spend: round2(row.spend) }));

        return {
          intent,
          sql: "SELECT TO_CHAR(ride_date, 'YYYY-MM') AS month, COUNT(*) AS rides, SUM(total_fare) AS spend FROM invoices GROUP BY 1 ORDER BY 1",
          rows,
        };
      }
      case "by_payment_mode": {
        const map = new Map<
          string,
          { payment_mode: string; rides: number; spend: number }
        >();

        for (const inv of invoices) {
          const mode = inv.payment_mode ?? "Unknown";
          const existing = map.get(mode) ?? {
            payment_mode: mode,
            rides: 0,
            spend: 0,
          };
          existing.rides += 1;
          existing.spend += inv.total_fare ?? 0;
          map.set(mode, existing);
        }

        const rows = Array.from(map.values())
          .sort((a, b) => b.rides - a.rides)
          .map((row) => ({ ...row, spend: round2(row.spend) }));

        return {
          intent,
          sql: "SELECT payment_mode, COUNT(*) AS rides, SUM(total_fare) AS spend FROM invoices GROUP BY 1 ORDER BY 2 DESC",
          rows,
        };
      }
      case "top_routes": {
        const map = new Map<
          string,
          {
            pickup_area: string;
            dropoff_area: string;
            rides: number;
            fare_sum: number;
          }
        >();

        for (const inv of invoices) {
          const pickup = inv.pickup_area ?? "Unknown";
          const dropoff = inv.dropoff_area ?? "Unknown";
          const key = `${pickup}__${dropoff}`;
          const existing = map.get(key) ?? {
            pickup_area: pickup,
            dropoff_area: dropoff,
            rides: 0,
            fare_sum: 0,
          };
          existing.rides += 1;
          existing.fare_sum += inv.total_fare ?? 0;
          map.set(key, existing);
        }

        const rows = Array.from(map.values())
          .map((row) => ({
            pickup_area: row.pickup_area,
            dropoff_area: row.dropoff_area,
            rides: row.rides,
            avg_fare: row.rides ? round2(row.fare_sum / row.rides) : 0,
          }))
          .sort((a, b) => b.rides - a.rides)
          .slice(0, 5);

        return {
          intent,
          sql: "SELECT pickup_area, dropoff_area, COUNT(*) AS rides, ROUND(AVG(total_fare)::numeric,2) AS avg_fare FROM invoices GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5",
          rows,
        };
      }
      case "top_captains": {
        const map = new Map<
          string,
          {
            captain_name: string;
            rides: number;
            fare_sum: number;
          }
        >();

        for (const inv of invoices) {
          const captain = inv.captain_name ?? "Unknown";
          const existing = map.get(captain) ?? {
            captain_name: captain,
            rides: 0,
            fare_sum: 0,
          };
          existing.rides += 1;
          existing.fare_sum += inv.total_fare ?? 0;
          map.set(captain, existing);
        }

        const rows = Array.from(map.values())
          .map((row) => ({
            captain_name: row.captain_name,
            rides: row.rides,
            avg_fare: row.rides ? round2(row.fare_sum / row.rides) : 0,
          }))
          .sort((a, b) => b.rides - a.rides)
          .slice(0, 5);

        return {
          intent,
          sql: "SELECT captain_name, COUNT(*) AS rides, ROUND(AVG(total_fare)::numeric,2) AS avg_fare FROM invoices GROUP BY 1 ORDER BY 2 DESC LIMIT 5",
          rows,
        };
      }
      case "longest_rides": {
        const rows = invoices
          .filter((inv) => inv.distance_km !== null)
          .sort((a, b) => (b.distance_km ?? 0) - (a.distance_km ?? 0))
          .slice(0, 5)
          .map((inv) => ({
            ride_date: inv.ride_date,
            pickup_area: inv.pickup_area,
            dropoff_area: inv.dropoff_area,
            distance_km: inv.distance_km,
            total_fare: inv.total_fare,
          }));

        return {
          intent,
          sql: "SELECT ride_date, pickup_area, dropoff_area, distance_km, total_fare FROM invoices ORDER BY distance_km DESC LIMIT 5",
          rows,
        };
      }
      case "most_expensive": {
        const rows = invoices
          .filter((inv) => inv.total_fare !== null)
          .sort((a, b) => (b.total_fare ?? 0) - (a.total_fare ?? 0))
          .slice(0, 5)
          .map((inv) => ({
            ride_date: inv.ride_date,
            pickup_area: inv.pickup_area,
            dropoff_area: inv.dropoff_area,
            total_fare: inv.total_fare,
            payment_mode: inv.payment_mode,
          }));

        return {
          intent,
          sql: "SELECT ride_date, pickup_area, dropoff_area, total_fare, payment_mode FROM invoices ORDER BY total_fare DESC LIMIT 5",
          rows,
        };
      }
      case "fastest_rides": {
        const rows = invoices
          .filter((inv) => inv.duration_mins !== null)
          .sort((a, b) => (a.duration_mins ?? 0) - (b.duration_mins ?? 0))
          .slice(0, 5)
          .map((inv) => ({
            ride_date: inv.ride_date,
            pickup_area: inv.pickup_area,
            dropoff_area: inv.dropoff_area,
            duration_mins: inv.duration_mins,
            distance_km: inv.distance_km,
          }));

        return {
          intent,
          sql: "SELECT ride_date, pickup_area, dropoff_area, duration_mins, distance_km FROM invoices ORDER BY duration_mins ASC LIMIT 5",
          rows,
        };
      }
      default:
        return {
          error: "Unsupported sql_query intent",
          available_intents: SAFE_SQL_INTENTS,
        };
    }
  },
  {
    name: "sql_query",
    description:
      "Use for totals, counts, averages, rankings, and structured numeric analysis.",
    schema: z.object({
      intent: z.string().min(1),
    }),
  }
);

const getInvoiceDetailTool = tool(
  async ({ ride_id }) => {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("ride_id", ride_id)
      .single();

    if (error) {
      throw new Error(`get_invoice_detail failed: ${error.message}`);
    }

    return {
      ride_id,
      invoice: data,
    };
  },
  {
    name: "get_invoice_detail",
    description: "Fetch full details for a specific ride ID.",
    schema: z.object({
      ride_id: z.string().min(2),
    }),
  }
);

let agentInstance: ReturnType<typeof createReactAgent> | null = null;

export function getRideIqAgent(): ReturnType<typeof createReactAgent> {
  if (!agentInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing environment variable: OPENAI_API_KEY");
    }

    agentInstance = createReactAgent({
      llm: new ChatOpenAI({ model: "gpt-4o", temperature: 0, apiKey }),
      tools: [vectorSearchTool, sqlQueryTool, getInvoiceDetailTool],
      prompt: SYSTEM_PROMPT,
    });
  }

  return agentInstance;
}
