import { buildChunkText, generateEmbedding } from "@/lib/embeddings";
import { extractRapidoInvoice } from "@/lib/docstrange";
import { logger } from "@/lib/logger";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { RapidoInvoiceData } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Upload failed";
}

function isExtractionTooSparse(data: RapidoInvoiceData): boolean {
  const criticalValues = [
    data.ride_id,
    data.invoice_no,
    data.ride_date,
    data.pickup,
    data.dropoff,
    data.total_fare,
    data.payment_mode,
    data.captain_name,
  ];

  return criticalValues.every((value) => value === null || value === "");
}

export async function POST(request: Request): Promise<Response> {
  try {
    logger.info("api.upload", "Upload request received");
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      logger.warn("api.upload", "Missing file in form data");
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      logger.warn("api.upload", "Rejected non-PDF file", {
        fileName: file.name,
        mimeType: file.type,
      });
      return Response.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    logger.info("api.upload", "Starting OCR extraction", {
      fileName: file.name,
      fileSize: file.size,
    });
    const extracted = await extractRapidoInvoice(file, file.name);

    if (isExtractionTooSparse(extracted)) {
      logger.error("api.upload", "Extraction output too sparse to insert", {
        fileName: file.name,
      });
      return Response.json(
        {
          error:
            "Could not extract enough invoice fields from this PDF. Please retry with a clearer file.",
        },
        { status: 422 }
      );
    }

    logger.debug("api.upload", "Building embedding chunk text", {
      rideId: extracted.ride_id,
    });
    const chunkText = buildChunkText(extracted);
    logger.debug("api.upload", "Generating embedding", {
      chunkLength: chunkText.length,
    });
    const embedding = await generateEmbedding(chunkText);

    const supabase = getSupabaseAdminClient();
    logger.info("api.upload", "Inserting invoice row");
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
        logger.warn("api.upload", "Duplicate invoice detected", {
          fileName: file.name,
          rideId: extracted.ride_id,
        });
        return Response.json(
          { error: "This invoice has already been uploaded." },
          { status: 409 }
        );
      }

      logger.error("api.upload", "Invoice insert failed", {
        error: invoiceError.message,
      });
      throw new Error(invoiceError.message);
    }

    logger.info("api.upload", "Inserting invoice chunk row", {
      invoiceId: invoice.id,
    });
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
      logger.warn("api.upload", "Embedding chunk insert failed", {
        invoiceId: invoice.id,
        error: chunkError.message,
      });
    }

    logger.info("api.upload", "Upload pipeline completed", {
      invoiceId: invoice.id,
      rideId: extracted.ride_id,
    });

    return Response.json({ success: true, invoice });
  } catch (error: unknown) {
    logger.error("api.upload", "Upload request failed", {
      error: getErrorMessage(error),
    });
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
