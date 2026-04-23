import { readFile } from "node:fs/promises";
import path from "node:path";

function now() {
  return new Date().toISOString();
}

function log(level, message, metadata = undefined) {
  const payload = {
    timestamp: now(),
    level,
    message,
    metadata,
  };
  console.log(JSON.stringify(payload));
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: "http://localhost:3000",
    file: null,
    question: "How much did I spend this month?",
    skipUpload: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--base-url" && argv[i + 1]) {
      parsed.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--file" && argv[i + 1]) {
      parsed.file = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--question" && argv[i + 1]) {
      parsed.question = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--skip-upload") {
      parsed.skipUpload = true;
    }
  }

  return parsed;
}

async function uploadInvoice(baseUrl, filePath) {
  const absoluteFilePath = path.resolve(filePath);
  const fileBytes = await readFile(absoluteFilePath);
  const formData = new FormData();
  formData.append(
    "file",
    new File([fileBytes], path.basename(absoluteFilePath), {
      type: "application/pdf",
    })
  );

  log("info", "Uploading invoice PDF", { filePath: absoluteFilePath });

  const response = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  log("info", "Upload API completed", {
    invoiceId: payload.invoice?.id,
    rideId: payload.invoice?.ride_id,
  });
}

async function fetchInvoices(baseUrl) {
  log("info", "Fetching invoice summary from API");
  const response = await fetch(`${baseUrl}/api/invoices`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Invoices API failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  log("info", "Invoices API completed", {
    totalInvoices: payload.invoices?.length ?? 0,
    stats: payload.stats,
  });

  return payload;
}

async function askAgent(baseUrl, question) {
  log("info", "Sending question to agent", { question });
  const response = await fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!response.ok || !response.body) {
    const bodyText = await response.text();
    throw new Error(`Agent API failed (${response.status}): ${bodyText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const lines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      for (const line of lines) {
        if (line === "[DONE]") {
          continue;
        }

        const payload = JSON.parse(line);
        if (payload.type === "token" && typeof payload.text === "string") {
          assistantText += payload.text;
        }

        if (payload.type === "tool_start") {
          log("info", "Agent tool started", { tool: payload.tool });
        }

        if (payload.type === "error") {
          throw new Error(`Agent stream error: ${payload.message}`);
        }
      }
    }
  }

  log("info", "Agent response received", {
    responseLength: assistantText.length,
  });
  console.log("\n----- RideIQ Agent Response -----\n");
  console.log(assistantText.trim());
  console.log("\n---------------------------------\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log("info", "Starting RideIQ CLI smoke test", args);

  if (!args.skipUpload && args.file) {
    await uploadInvoice(args.baseUrl, args.file);
  } else {
    log("info", "Upload step skipped", {
      reason: args.skipUpload ? "--skip-upload set" : "no --file provided",
    });
  }

  await fetchInvoices(args.baseUrl);
  await askAgent(args.baseUrl, args.question);

  log("info", "RideIQ CLI smoke test completed successfully");
}

main().catch((error) => {
  log("error", "RideIQ CLI smoke test failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
