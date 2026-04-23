import { buildChunkText, generateEmbedding } from "@/lib/embeddings";
import { extractRapidoInvoice } from "@/lib/docstrange";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Upload failed";
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return Response.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const extracted = await extractRapidoInvoice(file, file.name);
    const chunkText = buildChunkText(extracted);
    const embedding = await generateEmbedding(chunkText);

    const supabase = getSupabaseAdminClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        ride_id: extracted.ride_id,
        invoice_no: extracted.invoice_no,
        ride_date: extracted.ride_date,
        ride_time: extracted.ride_time,
        pickup: extracted.pickup,
        dropoff: extracted.dropoff,
        pickup_area: extracted.pickup_area,
        dropoff_area: extracted.dropoff_area,
        distance_km: extracted.distance_km,
        duration_mins: extracted.duration_mins,
        ride_charge: extracted.ride_charge,
        booking_fee: extracted.booking_fee,
        convenience_charges: extracted.convenience_charges,
        total_fare: extracted.total_fare,
        cgst_ride: extracted.cgst_ride,
        sgst_ride: extracted.sgst_ride,
        cgst_platform: extracted.cgst_platform,
        sgst_platform: extracted.sgst_platform,
        payment_mode: extracted.payment_mode,
        captain_name: extracted.captain_name,
        vehicle_number: extracted.vehicle_number,
        customer_name: extracted.customer_name,
        raw_markdown: extracted.raw_markdown,
        file_name: file.name,
      })
      .select()
      .single();

    if (invoiceError) {
      if (invoiceError.code === "23505") {
        return Response.json(
          { error: "This invoice has already been uploaded." },
          { status: 409 }
        );
      }

      throw new Error(invoiceError.message);
    }

    const { error: chunkError } = await supabase.from("invoice_chunks").insert({
      invoice_id: invoice.id,
      chunk_text: chunkText,
      embedding,
      metadata: {
        ride_id: extracted.ride_id,
        ride_date: extracted.ride_date,
        pickup_area: extracted.pickup_area,
        dropoff_area: extracted.dropoff_area,
        total_fare: extracted.total_fare,
        payment_mode: extracted.payment_mode,
        captain_name: extracted.captain_name,
      },
    });

    if (chunkError) {
      console.warn("Embedding chunk insert failed:", chunkError.message);
    }

    return Response.json({ success: true, invoice });
  } catch (error: unknown) {
    console.error("Upload error:", error);
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
