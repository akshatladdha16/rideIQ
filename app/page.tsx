import { UploadZone } from "@/components/upload-zone";
import { TopNav } from "@/components/top-nav";

export default function Home(): JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(2,132,199,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(20,184,166,0.12),transparent_30%),linear-gradient(to_bottom,#f8fafc,#f1f5f9)]">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10 md:py-16">
        <div className="space-y-3 text-center md:text-left">
          <p className="inline-flex rounded-full border bg-background/80 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Powered by Nanonets DocStrange OCR
          </p>
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
            RideIQ - Ask anything about your Rapido rides
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Upload your Rapido invoice PDFs, build a searchable history with embeddings, and
            chat with an agentic assistant that understands spend, routes, taxes, and trends.
          </p>
        </div>

        <div className="mt-8">
          <UploadZone />
        </div>
      </section>
    </main>
  );
}
