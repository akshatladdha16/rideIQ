import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { getRideIqAgent } from "@/lib/agent";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
};

function toLangChainMessages(messages: ChatInputMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return new AIMessage(message.content);
    }

    return new HumanMessage(message.content);
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Agent failed";
}

export async function POST(request: Request): Promise<Response> {
  logger.info("api.agent", "Agent request received");
  const body = (await request.json()) as { messages?: ChatInputMessage[] };
  const messages = toLangChainMessages(body.messages ?? []);
  logger.debug("api.agent", "Prepared LangChain messages", {
    inputMessages: body.messages?.length ?? 0,
    convertedMessages: messages.length,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let tokenEvents = 0;
      let responseChars = 0;
      let assistantResponse = "";
      const toolsUsed = new Set<string>();

      try {
        const agent = getRideIqAgent();
        logger.info("api.agent", "Streaming agent events started");
        const eventStream = agent.streamEvents({ messages }, { version: "v2" });

        for await (const event of eventStream) {
          if (
            event.event === "on_chat_model_stream" &&
            event.data &&
            "chunk" in event.data &&
            event.data.chunk
          ) {
            const chunk = event.data.chunk as { content?: unknown };
            if (typeof chunk.content === "string" && chunk.content.length > 0) {
              tokenEvents += 1;
              responseChars += chunk.content.length;
              assistantResponse += chunk.content;

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "token", text: chunk.content })}\n\n`
                )
              );
            }
          }

          if (event.event === "on_tool_start") {
            if (event.name) {
              toolsUsed.add(event.name);
            }
            logger.info("api.agent", "Tool execution started", {
              tool: event.name,
            });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_start", tool: event.name })}\n\n`
              )
            );
          }

          if (event.event === "on_tool_end") {
            logger.info("api.agent", "Tool execution completed", {
              tool: event.name,
            });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_end", tool: event.name })}\n\n`
              )
            );
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        logger.info("api.agent", "Streaming agent events completed", {
          tokenEvents,
          responseChars,
          toolsUsed: Array.from(toolsUsed),
          responsePreview: assistantResponse.slice(0, 200),
        });
      } catch (error: unknown) {
        logger.error("api.agent", "Agent stream failed", {
          error: getErrorMessage(error),
          tokenEvents,
          responseChars,
          toolsUsed: Array.from(toolsUsed),
        });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: getErrorMessage(error) })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
