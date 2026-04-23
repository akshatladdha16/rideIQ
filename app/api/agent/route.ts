import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { getRideIqAgent } from "@/lib/agent";

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
  const body = (await request.json()) as { messages?: ChatInputMessage[] };
  const messages = toLangChainMessages(body.messages ?? []);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        const agent = getRideIqAgent();
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
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "token", text: chunk.content })}\n\n`
                )
              );
            }
          }

          if (event.event === "on_tool_start") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_start", tool: event.name })}\n\n`
              )
            );
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error: unknown) {
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
