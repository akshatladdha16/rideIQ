import { logger } from "@/lib/logger";
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

type LooseRecord = Record<string, unknown>;

function toRecord(value: unknown): LooseRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as LooseRecord;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "").trim();
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function extractArea(address: string | null): string | null {
  if (!address) {
    return null;
  }

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const ignoredTokens = new Set([
    "india",
    "telangana",
    "hyderabad",
    "500081",
    "500084",
    "500032",
    "500001",
  ]);

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const lower = parts[i].toLowerCase();
    if (/^\d+$/.test(lower) || ignoredTokens.has(lower)) {
      continue;
    }
    return parts[i];
  }

  return null;
}

function ensureDocstrangeKey(): string {
  const key = process.env.DOCSTRANGE_API_KEY;
  if (!key) {
    logger.error("docstrange", "DOCSTRANGE_API_KEY missing");
    throw new Error("Missing environment variable: DOCSTRANGE_API_KEY");
  }
  return key;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function amountFromBillDetails(value: unknown, label: string): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const target = label.toLowerCase();

  for (const item of value) {
    const row = toRecord(item);
    if (!row) {
      continue;
    }

    const description = toText(row.description)?.toLowerCase();
    if (!description || !description.includes(target)) {
      continue;
    }

    const amount = toNumber(row.amount);
    if (amount !== null) {
      return amount;
    }
  }

  return null;
}

function amountFromBillDetailsByMatcher(
  value: unknown,
  matcher: (description: string) => boolean
): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    const row = toRecord(item);
    if (!row) {
      continue;
    }

    const description = toText(row.description)?.toLowerCase();
    if (!description || !matcher(description)) {
      continue;
    }

    const amount = toNumber(row.amount);
    if (amount !== null) {
      return amount;
    }
  }

  return null;
}

function parseDateFromNaturalText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseTimeFromNaturalText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  if (!match) {
    return null;
  }

  return match[1].toUpperCase().replace(/\s+/g, " ");
}

function parseJsonContent(value: unknown): LooseRecord | null {
  if (typeof value === "string") {
    const cleaned = value.replace(/```json|```/g, "").trim();
    if (!cleaned) {
      return null;
    }
    try {
      return toRecord(JSON.parse(cleaned));
    } catch {
      return null;
    }
  }

  return toRecord(value);
}

function pullFromPayload(payload: LooseRecord): Partial<RapidoInvoiceData> {
  const rideSummary = toRecord(payload.ride_summary) ?? toRecord(payload.payment_summary);
  const tspInvoice =
    toRecord(payload.tax_invoice_transport_provider) ?? toRecord(payload.tax_invoice_tsp);
  const platformInvoice =
    toRecord(payload.tax_invoice_roppen_transportation) ?? toRecord(payload.tax_invoice_rapido);
  const rideMetrics = rideSummary ? toRecord(rideSummary.ride_metrics) : null;
  const locations = rideSummary ? toRecord(rideSummary.locations) : null;
  const paymentMethod = rideSummary ? toRecord(rideSummary.payment_method) : null;

  const pickup =
    toText(payload.pickup) ??
    toText(rideSummary?.pickup_address) ??
    toText(locations?.pickup) ??
    toText(tspInvoice?.customer_pickup_address);

  const dropoff =
    toText(payload.dropoff) ??
    toText(rideSummary?.drop_address) ??
    toText(locations?.drop) ??
    toText(payload.drop_address);

  const invoiceNo =
    toText(payload.invoice_no) ??
    toText(payload.invoice_number) ??
    toText(tspInvoice?.invoice_number) ??
    toText(platformInvoice?.invoice_number);

  const rideDate =
    toText(payload.ride_date) ??
    parseDateFromNaturalText(toText(payload.time_of_ride)) ??
    parseDateFromNaturalText(toText(rideSummary?.time_of_ride)) ??
    parseDateFromNaturalText(toText(tspInvoice?.invoice_date));

  const rideTime =
    toText(payload.ride_time) ??
    parseTimeFromNaturalText(toText(payload.time_of_ride)) ??
    parseTimeFromNaturalText(toText(rideSummary?.time_of_ride)) ??
    parseTimeFromNaturalText(toText(tspInvoice?.invoice_date));

  return {
    ride_id: toText(payload.ride_id) ?? toText(rideSummary?.ride_id) ?? null,
    invoice_no: invoiceNo ?? null,
    ride_date: rideDate ?? null,
    ride_time: rideTime ?? null,
    pickup: pickup ?? null,
    dropoff: dropoff ?? null,
    pickup_area:
      toText(payload.pickup_area) ?? toText(payload.pickup_location) ?? null,
    dropoff_area:
      toText(payload.dropoff_area) ??
      toText(payload.dropoff_location) ??
      null,
    distance_km:
      toNumber(payload.distance_km) ??
      toNumber(payload.distance_kms) ??
      toNumber(rideSummary?.distance_km) ??
      toNumber(rideSummary?.distance_kms) ??
      toNumber(rideMetrics?.distance_km) ??
      toNumber(rideMetrics?.distance_kms),
    duration_mins:
      toNumber(payload.duration_mins) ??
      toNumber(rideSummary?.duration_mins) ??
      toNumber(rideMetrics?.duration_mins),
    ride_charge:
      toNumber(payload.ride_charge) ??
      amountFromBillDetails(payload.bill_details, "ride charge") ??
      amountFromBillDetails(tspInvoice?.bill_details, "ride charge"),
    booking_fee:
      amountFromBillDetailsByMatcher(platformInvoice?.bill_details, (description) =>
        description.includes("booking fee") && !description.includes("convenience")
      ) ??
      toNumber(payload.booking_fee) ??
      amountFromBillDetailsByMatcher(payload.bill_details, (description) =>
        description.includes("booking fee") && !description.includes("convenience")
      ),
    convenience_charges:
      amountFromBillDetailsByMatcher(platformInvoice?.bill_details, (description) =>
        description.includes("convenience")
      ) ??
      toNumber(payload.convenience_charges) ??
      amountFromBillDetailsByMatcher(payload.bill_details, (description) =>
        description.includes("convenience")
      ),
    total_fare:
      toNumber(payload.total_fare) ??
      toNumber(payload.total_amount) ??
      toNumber(rideSummary?.total_amount) ??
      amountFromBillDetails(payload.bill_details, "total amount"),
    cgst_ride:
      toNumber(payload.cgst_ride) ??
      amountFromBillDetails(tspInvoice?.bill_details, "cgst") ??
      null,
    sgst_ride:
      toNumber(payload.sgst_ride) ??
      amountFromBillDetails(tspInvoice?.bill_details, "sgst") ??
      null,
    cgst_platform:
      toNumber(payload.cgst_platform) ??
      amountFromBillDetails(platformInvoice?.bill_details, "cgst") ??
      null,
    sgst_platform:
      toNumber(payload.sgst_platform) ??
      amountFromBillDetails(platformInvoice?.bill_details, "sgst") ??
      null,
    payment_mode:
      toText(payload.payment_mode) ??
      toText(rideSummary?.payment_method) ??
      toText(paymentMethod?.type) ??
      null,
    captain_name: toText(payload.captain_name) ?? toText(tspInvoice?.captain_name) ?? null,
    vehicle_number: toText(payload.vehicle_number) ?? toText(tspInvoice?.vehicle_number) ?? null,
    customer_name: toText(payload.customer_name) ?? toText(tspInvoice?.customer_name) ?? null,
  };
}

function extractJsonObjectsFromMarkdown(markdown: string): LooseRecord[] {
  const objects: LooseRecord[] = [];

  const fencedRegex = /```json\s*([\s\S]*?)```/gi;
  let fencedMatch = fencedRegex.exec(markdown);
  while (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1].trim());
      const asRecord = toRecord(parsed);
      if (asRecord) {
        objects.push(asRecord);
      }
    } catch {
      // ignore invalid block
    }
    fencedMatch = fencedRegex.exec(markdown);
  }

  const segments = markdown.split(/##\s+Page\s+\d+/i).map((segment) => segment.trim());

  for (const segment of segments) {
    const start = segment.indexOf("{");
    const end = segment.lastIndexOf("}");
    if (start < 0 || end <= start) {
      continue;
    }

    const candidate = segment.slice(start, end + 1).trim();
    try {
      const parsed = JSON.parse(candidate);
      const asRecord = toRecord(parsed);
      if (asRecord) {
        objects.push(asRecord);
      }
    } catch {
      // ignore invalid slice
    }
  }

  return objects;
}

function mergePreferred(
  base: Partial<RapidoInvoiceData>,
  incoming: Partial<RapidoInvoiceData>
): Partial<RapidoInvoiceData> {
  const merged: Partial<RapidoInvoiceData> = { ...base };

  const keys: Array<keyof RapidoInvoiceData> = [
    "ride_id",
    "invoice_no",
    "ride_date",
    "ride_time",
    "pickup",
    "dropoff",
    "pickup_area",
    "dropoff_area",
    "distance_km",
    "duration_mins",
    "ride_charge",
    "booking_fee",
    "convenience_charges",
    "total_fare",
    "cgst_ride",
    "sgst_ride",
    "cgst_platform",
    "sgst_platform",
    "payment_mode",
    "captain_name",
    "vehicle_number",
    "customer_name",
    "raw_markdown",
  ];

  for (const key of keys) {
    const current = merged[key];
    const next = incoming[key];

    if ((current === null || current === undefined || current === "") && next !== undefined) {
      merged[key] = next as never;
    }
  }

  return merged;
}

export async function extractRapidoInvoice(
  pdfFile: File,
  fileName: string
): Promise<RapidoInvoiceData> {
  logger.info("docstrange", "Starting invoice extraction", {
    fileName,
    fileSize: pdfFile.size,
  });

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
    logger.error("docstrange", "Submit request failed", {
      fileName,
      status: submitRes.status,
    });
    throw new Error(
      `DocStrange submit failed: ${submitRes.status} ${await submitRes.text()}`
    );
  }

  const submitData = (await submitRes.json()) as { record_id?: string };
  if (!submitData.record_id) {
    logger.error("docstrange", "record_id missing from submit response", { fileName });
    throw new Error("DocStrange did not return record_id");
  }

  logger.info("docstrange", "Submit accepted", {
    fileName,
    recordId: submitData.record_id,
  });

  let result: LooseRecord | null = null;

  for (let i = 0; i < 10; i += 1) {
    logger.debug("docstrange", "Polling extraction status", {
      fileName,
      recordId: submitData.record_id,
      attempt: i + 1,
    });

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
      logger.error("docstrange", "Polling request failed", {
        fileName,
        recordId: submitData.record_id,
        status: pollRes.status,
      });
      throw new Error(
        `DocStrange poll failed: ${pollRes.status} ${await pollRes.text()}`
      );
    }

    const pollData = (await pollRes.json()) as {
      status?: string;
      result?: LooseRecord;
    };

    if (pollData.status === "completed") {
      result = pollData.result ?? null;
      logger.info("docstrange", "Extraction completed", {
        fileName,
        recordId: submitData.record_id,
        attempt: i + 1,
      });
      break;
    }

    if (pollData.status === "failed") {
      logger.error("docstrange", "Extraction marked failed", {
        fileName,
        recordId: submitData.record_id,
      });
      throw new Error(`DocStrange extraction failed for ${fileName}`);
    }

    logger.debug("docstrange", "Extraction still processing", {
      fileName,
      recordId: submitData.record_id,
      status: pollData.status ?? "unknown",
    });
  }

  if (!result) {
    logger.error("docstrange", "Extraction timed out", {
      fileName,
      recordId: submitData.record_id,
    });
    throw new Error("DocStrange timed out after 30s");
  }

  const jsonResult = toRecord(result.json);
  const markdownResult = toRecord(result.markdown);

  const parsedJsonPayload = parseJsonContent(jsonResult?.content);
  if (!parsedJsonPayload) {
    logger.warn("docstrange", "JSON content was missing or unparsable", {
      fileName,
      recordId: submitData.record_id,
    });
  }

  let normalized: Partial<RapidoInvoiceData> = {};

  if (parsedJsonPayload) {
    normalized = mergePreferred(normalized, pullFromPayload(parsedJsonPayload));
  }

  const markdownContent = toText(markdownResult?.content) ?? "";
  const markdownObjects = extractJsonObjectsFromMarkdown(markdownContent);
  for (const markdownObject of markdownObjects) {
    normalized = mergePreferred(normalized, pullFromPayload(markdownObject));
  }

  const parsed: RapidoInvoiceData = {
    ride_id: normalized.ride_id ?? null,
    invoice_no: normalized.invoice_no ?? null,
    ride_date: normalized.ride_date ?? null,
    ride_time: normalized.ride_time ?? null,
    pickup: normalized.pickup ?? null,
    dropoff: normalized.dropoff ?? null,
    pickup_area:
      normalized.pickup_area ??
      extractArea(toText(normalized.pickup) ?? null) ??
      null,
    dropoff_area:
      normalized.dropoff_area ??
      extractArea(toText(normalized.dropoff) ?? null) ??
      null,
    distance_km: toNumber(normalized.distance_km),
    duration_mins: toNumber(normalized.duration_mins),
    ride_charge: toNumber(normalized.ride_charge),
    booking_fee: toNumber(normalized.booking_fee),
    convenience_charges: toNumber(normalized.convenience_charges),
    total_fare: toNumber(normalized.total_fare),
    cgst_ride: toNumber(normalized.cgst_ride),
    sgst_ride: toNumber(normalized.sgst_ride),
    cgst_platform: toNumber(normalized.cgst_platform),
    sgst_platform: toNumber(normalized.sgst_platform),
    payment_mode: normalized.payment_mode ?? null,
    captain_name: normalized.captain_name ?? null,
    vehicle_number: normalized.vehicle_number ?? null,
    customer_name: normalized.customer_name ?? null,
    raw_markdown: markdownContent,
  };

  logger.info("docstrange", "Extraction normalized", {
    fileName,
    rideId: parsed.ride_id,
    invoiceNo: parsed.invoice_no,
    missingFields: Object.entries(parsed)
      .filter(([key, value]) => key !== "raw_markdown" && (value === null || value === ""))
      .map(([key]) => key),
  });

  return parsed;
}
