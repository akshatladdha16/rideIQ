import { readFile } from "node:fs/promises";
import path from "node:path";

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

function parseArgs(argv) {
  const parsed = { file: null, timeoutSeconds: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file" && argv[i + 1]) {
      parsed.file = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--timeout" && argv[i + 1]) {
      parsed.timeoutSeconds = Number(argv[i + 1]);
      i += 1;
    }
  }
  return parsed;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEnvLocal() {
  const envPath = path.resolve(".env.local");
  try {
    const raw = await readFile(envPath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex < 1) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore if .env.local is missing; process env may already be set.
  }
}

async function main() {
  await loadEnvLocal();

  const { file, timeoutSeconds } = parseArgs(process.argv.slice(2));

  if (!file) {
    throw new Error("Missing --file argument. Example: --file assets/invoice.pdf");
  }

  if (!process.env.DOCSTRANGE_API_KEY) {
    throw new Error("Missing DOCSTRANGE_API_KEY in environment");
  }

  const absoluteFile = path.resolve(file);
  const fileBytes = await readFile(absoluteFile);

  const formData = new FormData();
  formData.append(
    "file",
    new File([fileBytes], path.basename(absoluteFile), { type: "application/pdf" })
  );
  formData.append("output_format", "markdown,json");
  formData.append("custom_instructions", RAPIDO_EXTRACTION_INSTRUCTIONS);
  formData.append("prompt_mode", "replace");

  const submitRes = await fetch(`${DOCSTRANGE_BASE}/api/v1/extract/async`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DOCSTRANGE_API_KEY}`,
    },
    body: formData,
  });

  if (!submitRes.ok) {
    throw new Error(`Submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  const submitData = await submitRes.json();
  const recordId = submitData.record_id;
  if (!recordId) {
    throw new Error("DocStrange did not return record_id");
  }

  console.log(`Submitted OCR job. record_id=${recordId}`);

  const maxAttempts = Math.max(1, Math.floor(timeoutSeconds / 3));
  let result = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await sleep(3000);
    const pollRes = await fetch(`${DOCSTRANGE_BASE}/api/v1/extract/results/${recordId}`, {
      headers: {
        Authorization: `Bearer ${process.env.DOCSTRANGE_API_KEY}`,
      },
    });

    if (!pollRes.ok) {
      throw new Error(`Poll failed: ${pollRes.status} ${await pollRes.text()}`);
    }

    const pollData = await pollRes.json();
    if (pollData.status === "completed") {
      result = pollData.result;
      break;
    }
    if (pollData.status === "failed") {
      throw new Error("DocStrange extraction failed");
    }

    console.log(`Polling attempt ${attempt}/${maxAttempts}: ${pollData.status}`);
  }

  if (!result) {
    throw new Error("Timed out waiting for extraction result");
  }

  const jsonContent = result?.json?.content;
  const rawJson =
    typeof jsonContent === "string"
      ? jsonContent
      : jsonContent
        ? JSON.stringify(jsonContent)
        : "";
  const cleanJson = rawJson.replace(/```json|```/g, "").trim();

  console.log("\n=== Parsed JSON Output ===\n");
  try {
    const parsed = JSON.parse(cleanJson);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(cleanJson || "(empty json output)");
  }

  console.log("\n=== Markdown Preview (first 1200 chars) ===\n");
  const markdown = result?.markdown?.content ?? "";
  console.log(markdown.slice(0, 1200));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
