import OpenAI from "openai";

import { RapidoInvoiceData } from "@/lib/types";

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing environment variable: OPENAI_API_KEY");
    }
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await getOpenAIClient().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return res.data[0].embedding;
}

export function buildChunkText(inv: RapidoInvoiceData): string {
  return [
    `Rapido ride on ${inv.ride_date ?? "unknown date"} at ${inv.ride_time ?? "unknown time"}.`,
    `From ${inv.pickup_area ?? "unknown pickup area"} (${inv.pickup ?? "pickup unavailable"}) to ${inv.dropoff_area ?? "unknown dropoff area"} (${inv.dropoff ?? "dropoff unavailable"}).`,
    `Distance: ${inv.distance_km ?? "unknown"} km in ${inv.duration_mins ?? "unknown"} mins.`,
    `Total fare: INR ${inv.total_fare ?? "unknown"} (Ride: INR ${inv.ride_charge ?? 0} + Platform: INR ${(inv.booking_fee ?? 0) + (inv.convenience_charges ?? 0)}).`,
    `Paid via ${inv.payment_mode ?? "unknown"}.`,
    `Captain: ${inv.captain_name ?? "unknown"}, Vehicle: ${inv.vehicle_number ?? "unknown"}.`,
    `Ride ID: ${inv.ride_id ?? "unknown"}.`,
  ].join(" ");
}
