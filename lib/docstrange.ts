import { RapidoInvoiceData } from "@/lib/types";

const DOCSTRANGE_BASE = "https://extraction-api.nanonets.com";

const RAPIDO_EXTRACTION_INSTRUCTIONS = `
This is a Rapido ride invoice PDF with 3 pages. Extract the following fields and return
ONLY a flat JSON object with no markdown formatting, no code fences, no explanation.

{
  "ride_id": "booking ID starting with RD from page 1",
  "invoice_no": "invoice number from Tax Invoice page (e.g. 2627TS0001536905)",
  "ride_date": "YYYY-MM-DD format",
  "ride_time": "HH:MM AM/PM format",
  "pickup": "full pickup address string",
  "dropoff": "full dropoff address string",
  "pickup_area": "short neighborhood from pickup address (e.g. Madhapur)",
  "dropoff_area": "short neighborhood from dropoff address (e.g. Gachibowli)",
  "distance_km": 2.43,
  "duration_mins": 5.47,
  "ride_charge": 36.00,
  "booking_fee": 1.00,
  "convenience_charges": 6.62,
  "total_fare": 45.00,
  "cgst_ride": 0.86,
  "sgst_ride": 0.86,
  "cgst_platform": 0.69,
  "sgst_platform": 0.69,
  "payment_mode": "Cash or UPI or Rapido Money",
  "captain_name": "captain full name",
  "vehicle_number": "vehicle registration number",
  "customer_name": "customer first name"
}

All numeric fields must be numbers not strings. If a field is not found use null.
`;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureDocstrangeKey(): string {
  const key = process.env.DOCSTRANGE_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: DOCSTRANGE_API_KEY");
  }
  return key;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function extractRapidoInvoice(
  pdfFile: File,
  fileName: string
): Promise<RapidoInvoiceData> {
  const token = ensureDocstrangeKey();

  const formData = new FormData();
  formData.append("file", pdfFile, fileName);
  formData.append("output_format", "markdown,json");
  formData.append("custom_instructions", RAPIDO_EXTRACTION_INSTRUCTIONS);
  formData.append("prompt_mode", "replace");

  const submitRes = await fetch(`${DOCSTRANGE_BASE}/api/v1/extract/async`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!submitRes.ok) {
    throw new Error(
      `DocStrange submit failed: ${submitRes.status} ${await submitRes.text()}`
    );
  }

  const submitData = (await submitRes.json()) as { record_id?: string };
  if (!submitData.record_id) {
    throw new Error("DocStrange did not return record_id");
  }

  let result: Record<string, unknown> | null = null;

  for (let i = 0; i < 10; i += 1) {
    await sleep(3000);

    const pollRes = await fetch(
      `${DOCSTRANGE_BASE}/api/v1/extract/results/${submitData.record_id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!pollRes.ok) {
      throw new Error(
        `DocStrange poll failed: ${pollRes.status} ${await pollRes.text()}`
      );
    }

    const pollData = (await pollRes.json()) as {
      status?: string;
      result?: Record<string, unknown>;
    };

    if (pollData.status === "completed") {
      result = pollData.result ?? null;
      break;
    }

    if (pollData.status === "failed") {
      throw new Error(`DocStrange extraction failed for ${fileName}`);
    }
  }

  if (!result) {
    throw new Error("DocStrange timed out after 30s");
  }

  let structured: Partial<RapidoInvoiceData> = {};
  try {
    const jsonResult = result.json as { content?: string } | undefined;
    const jsonContent = jsonResult?.content ?? "";
    const clean = jsonContent.replace(/```json|```/g, "").trim();
    structured = clean ? (JSON.parse(clean) as Partial<RapidoInvoiceData>) : {};
  } catch {
    console.warn("Could not parse JSON from DocStrange; falling back to nulls");
  }

  const markdownResult = result.markdown as { content?: string } | undefined;

  return {
    ride_id: structured.ride_id ?? null,
    invoice_no: structured.invoice_no ?? null,
    ride_date: structured.ride_date ?? null,
    ride_time: structured.ride_time ?? null,
    pickup: structured.pickup ?? null,
    dropoff: structured.dropoff ?? null,
    pickup_area: structured.pickup_area ?? null,
    dropoff_area: structured.dropoff_area ?? null,
    distance_km: toNumber(structured.distance_km),
    duration_mins: toNumber(structured.duration_mins),
    ride_charge: toNumber(structured.ride_charge),
    booking_fee: toNumber(structured.booking_fee),
    convenience_charges: toNumber(structured.convenience_charges),
    total_fare: toNumber(structured.total_fare),
    cgst_ride: toNumber(structured.cgst_ride),
    sgst_ride: toNumber(structured.sgst_ride),
    cgst_platform: toNumber(structured.cgst_platform),
    sgst_platform: toNumber(structured.sgst_platform),
    payment_mode: structured.payment_mode ?? null,
    captain_name: structured.captain_name ?? null,
    vehicle_number: structured.vehicle_number ?? null,
    customer_name: structured.customer_name ?? null,
    raw_markdown: markdownResult?.content ?? "",
  };
}
