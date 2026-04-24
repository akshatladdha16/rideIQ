"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  metadata?: AssistantMetadata;
};

type ToolEvent = {
  type: "tool_start" | "tool_end";
  tool: string;
  at: string;
};

type AssistantMetadata = {
  toolsUsed: string[];
  tokenEvents: number;
  responseChars: number;
  durationMs?: number;
  startedAt: string;
  completedAt?: string;
  toolEvents: ToolEvent[];
};

const STARTER_PROMPTS = [
  "How much did I spend this month?",
  "Which route do I take most often?",
  "What was my most expensive ride?",
  "How much GST have I paid in total?",
  "Which captain drove me the most?",
  "Compare my cash vs UPI spend",
];

const TOOL_STATUS: Record<string, string> = {
  vector_search: "🔍 Searching invoices semantically...",
  sql_query: "📊 Running query...",
  get_invoice_detail: "📄 Fetching ride details...",
};

interface ChatInterfaceProps {
  initialPrompt?: string;
}

export function ChatInterface({ initialPrompt }: ChatInterfaceProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialPrompt) {
      setInput(`Show details for ride_id ${initialPrompt}`);
    }
  }, [initialPrompt]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, toolStatus]);

  const canSend = useMemo(
    () => input.trim().length > 0 && !isLoading,
    [input, isLoading]
  );

  async function sendMessage(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || isLoading) {
      return;
    }

    const startedAt = new Date().toISOString();
    const initialMetadata: AssistantMetadata = {
      startedAt,
      toolsUsed: [],
      tokenEvents: 0,
      responseChars: 0,
      toolEvents: [],
    };

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: prompt },
      { role: "assistant", content: "", metadata: initialMetadata },
    ];
    const assistantIndex = nextMessages.length - 1;
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);
    setToolStatus(null);

    let assistantText = "";
    let metadata: AssistantMetadata = initialMetadata;

    const updateAssistant = (nextContent?: string): void => {
      setMessages((prev) => {
        const copy = [...prev];
        const assistant = copy[assistantIndex];
        if (!assistant || assistant.role !== "assistant") {
          return prev;
        }

        copy[assistantIndex] = {
          ...assistant,
          content: nextContent ?? assistant.content,
          metadata: { ...metadata },
        };

        return copy;
      });
    };

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start agent stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventChunk of events) {
          const lines = eventChunk
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6));

          for (const line of lines) {
            if (line === "[DONE]") {
              setToolStatus(null);
              continue;
            }

            const payload = JSON.parse(line) as {
              type: "token" | "tool_start" | "tool_end" | "response_meta" | "error";
              text?: string;
              tool?: string;
              message?: string;
              tokenEvents?: number;
              responseChars?: number;
              toolsUsed?: string[];
              durationMs?: number;
            };

            if (payload.type === "token" && payload.text) {
              assistantText += payload.text;
              metadata = {
                ...metadata,
                tokenEvents: metadata.tokenEvents + 1,
                responseChars: assistantText.length,
              };
              updateAssistant(assistantText);
            }

            if (payload.type === "tool_start") {
              const toolName = payload.tool ?? "unknown";
              metadata = {
                ...metadata,
                toolsUsed: metadata.toolsUsed.includes(toolName)
                  ? metadata.toolsUsed
                  : [...metadata.toolsUsed, toolName],
                toolEvents: [
                  ...metadata.toolEvents,
                  { type: "tool_start", tool: toolName, at: new Date().toISOString() },
                ],
              };
              updateAssistant();
              setToolStatus(payload.tool ? TOOL_STATUS[payload.tool] ?? "Calling tool..." : "Calling tool...");
            }

            if (payload.type === "tool_end") {
              const toolName = payload.tool ?? "unknown";
              metadata = {
                ...metadata,
                toolEvents: [
                  ...metadata.toolEvents,
                  { type: "tool_end", tool: toolName, at: new Date().toISOString() },
                ],
              };
              updateAssistant();
              setToolStatus(null);
            }

            if (payload.type === "response_meta") {
              metadata = {
                ...metadata,
                tokenEvents: payload.tokenEvents ?? metadata.tokenEvents,
                responseChars: payload.responseChars ?? metadata.responseChars,
                toolsUsed: payload.toolsUsed ?? metadata.toolsUsed,
                durationMs: payload.durationMs ?? metadata.durationMs,
              };
              updateAssistant();
            }

            if (payload.type === "error") {
              throw new Error(payload.message ?? "Agent error");
            }
          }
        }

        metadata = {
          ...metadata,
          completedAt: new Date().toISOString(),
          durationMs: metadata.durationMs ?? Date.now() - new Date(metadata.startedAt).getTime(),
        };
        updateAssistant();
      }
    } catch (error: unknown) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[assistantIndex] = {
          role: "assistant",
          content:
            error instanceof Error
              ? `Sorry, I hit an error: ${error.message}`
              : "Sorry, I hit an unexpected error.",
          metadata: {
            ...metadata,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - new Date(metadata.startedAt).getTime(),
          },
        };
        return copy;
      });
    } finally {
      setIsLoading(false);
      setToolStatus(null);
    }
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col rounded-2xl border bg-card/50">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-4 rounded-xl border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              Ask anything about your Rapido commute spend, taxes, routes, and ride patterns.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <Button key={prompt} variant="outline" size="sm" onClick={() => void sendMessage(prompt)}>
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-3xl rounded-xl px-4 py-3 ${
              message.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "mr-auto border bg-background text-foreground"
            }`}
          >
            {message.role === "assistant" ? (
              <article className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-li:text-foreground dark:prose-invert [&_*]:break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </article>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{message.content}</p>
            )}

            {message.role === "assistant" && message.metadata ? (
              <details className="mt-3 rounded-md border border-dashed p-2 text-xs">
                <summary className="cursor-pointer select-none text-muted-foreground">
                  View steps and tools used
                </summary>
                <div className="mt-2 space-y-2 text-foreground">
                  <p>
                    Tools: {message.metadata.toolsUsed.length > 0 ? message.metadata.toolsUsed.join(", ") : "None"}
                  </p>
                  <p>
                    Tokens streamed: {message.metadata.tokenEvents} | Characters: {message.metadata.responseChars}
                    {typeof message.metadata.durationMs === "number"
                      ? ` | Duration: ${(message.metadata.durationMs / 1000).toFixed(1)}s`
                      : ""}
                  </p>
                  <div>
                    <p className="mb-1 font-medium">Tool timeline</p>
                    {message.metadata.toolEvents.length > 0 ? (
                      <ul className="space-y-1">
                        {message.metadata.toolEvents.map((event, eventIndex) => (
                          <li key={`${event.at}-${eventIndex}`}>
                            {new Date(event.at).toLocaleTimeString()} - {event.type === "tool_start" ? "Start" : "End"}:{" "}
                            {event.tool}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No tools called.</p>
                    )}
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        ))}

        {toolStatus && <p className="text-sm text-muted-foreground">{toolStatus}</p>}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
        <div className="flex gap-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask RideIQ about your Rapido invoices..."
            className="min-h-16"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
          />
          <Button disabled={!canSend} onClick={() => void sendMessage(input)}>
            Send
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Press Cmd/Ctrl + Enter to send</p>
      </div>
    </div>
  );
}
