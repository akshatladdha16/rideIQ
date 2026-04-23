import { ChatInterface } from "@/components/chat-interface";
import { TopNav } from "@/components/top-nav";

interface ChatPageProps {
  searchParams?: {
    ride_id?: string;
  };
}

export default function ChatPage({ searchParams }: ChatPageProps): JSX.Element {
  return (
    <main className="min-h-screen bg-muted/30">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">RideIQ Agentic Chat</h1>
          <p className="text-sm text-muted-foreground">
            Ask natural language questions about spending, routes, captains, and taxes.
          </p>
        </div>

        <ChatInterface initialPrompt={searchParams?.ride_id} />
      </section>
    </main>
  );
}
