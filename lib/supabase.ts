import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ensureEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

let browserClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(
      ensureEnv(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      ensureEnv(supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY")
    );
  }
  return browserClient;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      ensureEnv(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      ensureEnv(supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return adminClient;
}

export const SAFE_SQL_INTENTS = [
  "total_spend",
  "ride_count",
  "avg_fare",
  "avg_fare_per_km",
  "total_gst",
  "by_month",
  "by_payment_mode",
  "top_routes",
  "top_captains",
  "longest_rides",
  "most_expensive",
  "fastest_rides",
] as const;

export type SqlIntent = (typeof SAFE_SQL_INTENTS)[number];
