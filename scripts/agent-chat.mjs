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
    question: "How much did I spend this month?",
    printTokens: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--base-url" && argv[i + 1]) {
      parsed.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--question" && argv[i + 1]) {
      parsed.question = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--print-tokens") {
      parsed.printTokens = true;
    }
  }

  return parsed;
}

async function askAgent(baseUrl, question, printTokens) {
  log("info", "Sending agent request", {
    baseUrl,
    question,
  });

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
  const toolsUsed = new Set();

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
          if (printTokens) {
            process.stdout.write(payload.text);
          }
        }

        if (payload.type === "tool_start") {
          if (payload.tool) {
            toolsUsed.add(payload.tool);
          }
          log("info", "Tool started", { tool: payload.tool ?? "unknown" });
        }

        if (payload.type === "tool_end") {
          log("info", "Tool completed", { tool: payload.tool ?? "unknown" });
        }

        if (payload.type === "error") {
          throw new Error(`Agent stream error: ${payload.message}`);
        }
      }
    }
  }

  if (printTokens) {
    process.stdout.write("\n");
  }

  log("info", "Agent response completed", {
    responseLength: assistantText.length,
    toolsUsed: Array.from(toolsUsed),
  });

  console.log("\n----- RideIQ Agent Response -----\n");
  console.log(assistantText.trim());
  console.log("\n---------------------------------\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await askAgent(args.baseUrl, args.question, args.printTokens);
}

main().catch((error) => {
  log("error", "Agent CLI failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
