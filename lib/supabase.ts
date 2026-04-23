import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function extractJwtMeta(token: string | undefined): { ref: string | null; role: string | null } {
  if (!token) {
    return { ref: null, role: null };
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return { ref: null, role: null };
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      ref?: string;
      role?: string;
    };
    return {
      ref: payload.ref ?? null,
      role: payload.role ?? null,
    };
  } catch {
    return { ref: null, role: null };
  }
}

function extractProjectRefFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

async function noStoreFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: "no-store",
    next: { revalidate: 0 },
  });
}

function ensureEnv(value: string | undefined, name: string): string {
  if (!value) {
    logger.error("supabase", "Missing required environment variable", { name });
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

let browserClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    logger.info("supabase", "Initializing browser supabase client");
    browserClient = createClient(
      ensureEnv(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      ensureEnv(supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        global: {
          fetch: noStoreFetch,
        },
      }
    );
  }
  return browserClient;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    const jwtMeta = extractJwtMeta(supabaseServiceRoleKey);
    logger.info("supabase", "Initializing admin supabase client", {
      urlProjectRef: extractProjectRefFromUrl(supabaseUrl),
      serviceRoleProjectRef: jwtMeta.ref,
      serviceRoleClaim: jwtMeta.role,
    });
    adminClient = createClient(
      ensureEnv(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      ensureEnv(supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          fetch: noStoreFetch,
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
