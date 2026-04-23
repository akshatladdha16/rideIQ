You are an expert full-stack AI engineer. Build a production-grade Agentic RAG web application 
called "RideIQ" — an intelligent invoice analyst for Rapido ride invoices. This is a portfolio 
project targeting Nanonets (a document OCR company), so the architecture must be clean, 
impressive, and showcase real agentic reasoning over documents.

---

## PROJECT GOAL

Users upload PDF invoices from Rapido (a ride-hailing app). The system OCRs them via the 
DocStrange API by Nanonets, stores structured data + vector embeddings in Supabase, and exposes 
a LangGraph-powered agentic chat interface where users can ask natural language questions like:
- "How much did I spend on rides in March?"
- "Which week had the most rides?"
- "What's my average fare per km?"
- "How much GST have I paid total?"
- "Which captain drove me the most?"
- "Show me all cash rides over ₹200"

---

## TECH STACK (strict — do not deviate)

- Frontend: Next.js 14 App Router + shadcn/ui + Tailwind CSS
- Backend: Next.js API Routes (Node runtime)
- Agent Framework: LangGraph.js (JS/TS SDK — @langchain/langgraph)
- LLM: OpenAI GPT-4o (via @langchain/openai)
- OCR: DocStrange API by Nanonets (free tier) — extraction-api.nanonets.com
- Database: Supabase (Postgres + pgvector extension)
- Client: Supabase JS client (no Prisma)
- Embeddings: OpenAI text-embedding-3-small
- Deployment: Vercel — all code must be Vercel-compatible, no long-running servers
- Auth: None (keep simple for portfolio)

---

## FOLDER STRUCTURE

/
├── app/
│   ├── page.tsx                        # Landing + upload UI
│   ├── dashboard/page.tsx              # Invoice list + stats
│   ├── chat/page.tsx                   # Agentic chat interface
│   └── api/
│       ├── upload/route.ts             # PDF → DocStrange OCR → Supabase
│       ├── agent/route.ts              # LangGraph agent streaming endpoint
│       └── invoices/route.ts           # GET invoice list + stats
├── components/
│   ├── upload-zone.tsx                 # Drag-and-drop PDF uploader
│   ├── invoice-table.tsx               # Invoice list with filters
│   ├── chat-interface.tsx              # Chat UI with streaming
│   ├── stats-cards.tsx                 # Summary stat cards
│   └── invoice-detail.tsx             # Single invoice expanded view
├── lib/
│   ├── docstrange.ts                   # DocStrange OCR API client
│   ├── supabase.ts                     # Supabase client + DB helpers
│   ├── embeddings.ts                   # OpenAI embedding utility
│   ├── agent.ts                        # LangGraph agent (tools + graph)
│   └── types.ts                        # Shared TypeScript types
├── .env.local.example
└── README.md

---

## DATABASE SCHEMA

Run this in the Supabase SQL editor before starting development.

```sql
-- Enable pgvector
create extension if not exists vector;

-- Main invoices table
create table invoices (
  id uuid primary key default gen_random_uuid(),
  uploaded_at timestamptz default now(),

  -- Identity
  ride_id text unique,
  invoice_no text,

  -- Ride info
  ride_date date,
  ride_time text,
  pickup text,
  dropoff text,
  pickup_area text,
  dropoff_area text,
  distance_km numeric,
  duration_mins numeric,

  -- Fare breakdown
  ride_charge numeric,
  booking_fee numeric,
  convenience_charges numeric,
  total_fare numeric,
  cgst_ride numeric,
  sgst_ride numeric,
  cgst_platform numeric,
  sgst_platform numeric,

  -- Payment
  payment_mode text,

  -- Captain
  captain_name text,
  vehicle_number text,

  -- Customer
  customer_name text,

  -- Raw
  raw_markdown text,
  file_name text
);

-- Chunks table for vector search
create table invoice_chunks (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  chunk_text text not null,
  embedding vector(1536),
  metadata jsonb
);

-- pgvector similarity search function
create or replace function match_invoice_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id uuid,
  invoice_id uuid,
  chunk_text text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    ic.id,
    ic.invoice_id,
    ic.chunk_text,
    ic.metadata,
    1 - (ic.embedding <=> query_embedding) as similarity
  from invoice_chunks ic
  where 1 - (ic.embedding <=> query_embedding) > match_threshold
  order by ic.embedding <=> query_embedding
  limit match_count;
$$;
```

---

## TYPES (lib/types.ts)

```typescript
export interface RapidoInvoiceData {
  ride_id: string | null;
  invoice_no: string | null;
  ride_date: string | null;          // YYYY-MM-DD
  ride_time: string | null;          // "10:49 PM"
  pickup: string | null;
  dropoff: string | null;
  pickup_area: string | null;        // short label e.g. "Madhapur"
  dropoff_area: string | null;       // short label e.g. "Gachibowli"
  distance_km: number | null;
  duration_mins: number | null;
  ride_charge: number | null;
  booking_fee: number | null;
  convenience_charges: number | null;
  total_fare: number | null;
  cgst_ride: number | null;
  sgst_ride: number | null;
  cgst_platform: number | null;
  sgst_platform: number | null;
  payment_mode: string | null;
  captain_name: string | null;
  vehicle_number: string | null;
  customer_name: string | null;
  raw_markdown: string;
}
```

---

## DOCSTRANGE OCR CLIENT (lib/docstrange.ts)

DocStrange is Nanonets' free document extraction API.
- Base URL: https://extraction-api.nanonets.com
- Auth: Bearer token → Authorization: Bearer YOUR_API_KEY
- No Model ID needed
- Rapido invoices are 3 pages — use async endpoint (sync is max 5 pages, async is safer)
- Request both markdown + json output formats in one call
- Use custom_instructions with prompt_mode: replace to guide extraction

```typescript
import { RapidoInvoiceData } from './types';

const DOCSTRANGE_BASE = 'https://extraction-api.nanonets.com';

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

export async function extractRapidoInvoice(
  pdfBuffer: Buffer,
  fileName: string
): Promise<RapidoInvoiceData> {
  // Step 1: Submit async job
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName);
  formData.append('output_format', 'markdown,json');
  formData.append('custom_instructions', RAPIDO_EXTRACTION_INSTRUCTIONS);
  formData.append('prompt_mode', 'replace');

  const submitRes = await fetch(`${DOCSTRANGE_BASE}/api/v1/extract/async`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DOCSTRANGE_API_KEY}`,
    },
    body: formData,
  });

  if (!submitRes.ok) {
    throw new Error(`DocStrange submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  const { record_id } = await submitRes.json();

  // Step 2: Poll for result (max 30s, 3s intervals)
  let result = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(
      `${DOCSTRANGE_BASE}/api/v1/extract/results/${record_id}`,
      { headers: { Authorization: `Bearer ${process.env.DOCSTRANGE_API_KEY}` } }
    );
    const pollData = await pollRes.json();
    if (pollData.status === 'completed') {
      result = pollData.result;
      break;
    }
    if (pollData.status === 'failed') {
      throw new Error(`DocStrange extraction failed for ${fileName}`);
    }
  }

  if (!result) throw new Error('DocStrange timed out after 30s');

  // Step 3: Parse structured JSON output
  let structured: Partial<RapidoInvoiceData> = {};
  try {
    const jsonContent = result?.json?.content ?? '';
    const clean = jsonContent.replace(/```json|```/g, '').trim();
    structured = JSON.parse(clean);
  } catch {
    console.warn('Could not parse JSON from DocStrange — falling back to nulls');
  }

  return {
    ride_id: structured.ride_id ?? null,
    invoice_no: structured.invoice_no ?? null,
    ride_date: structured.ride_date ?? null,
    ride_time: structured.ride_time ?? null,
    pickup: structured.pickup ?? null,
    dropoff: structured.dropoff ?? null,
    pickup_area: structured.pickup_area ?? null,
    dropoff_area: structured.dropoff_area ?? null,
    distance_km: structured.distance_km ? Number(structured.distance_km) : null,
    duration_mins: structured.duration_mins ? Number(structured.duration_mins) : null,
    ride_charge: structured.ride_charge ? Number(structured.ride_charge) : null,
    booking_fee: structured.booking_fee ? Number(structured.booking_fee) : null,
    convenience_charges: structured.convenience_charges ? Number(structured.convenience_charges) : null,
    total_fare: structured.total_fare ? Number(structured.total_fare) : null,
    cgst_ride: structured.cgst_ride ? Number(structured.cgst_ride) : null,
    sgst_ride: structured.sgst_ride ? Number(structured.sgst_ride) : null,
    cgst_platform: structured.cgst_platform ? Number(structured.cgst_platform) : null,
    sgst_platform: structured.sgst_platform ? Number(structured.sgst_platform) : null,
    payment_mode: structured.payment_mode ?? null,
    captain_name: structured.captain_name ?? null,
    vehicle_number: structured.vehicle_number ?? null,
    customer_name: structured.customer_name ?? null,
    raw_markdown: result?.markdown?.content ?? '',
  };
}
```

---

## EMBEDDINGS (lib/embeddings.ts)

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

export function buildChunkText(inv: RapidoInvoiceData): string {
  return [
    `Rapido ride on ${inv.ride_date} at ${inv.ride_time}.`,
    `From ${inv.pickup_area} (${inv.pickup}) to ${inv.dropoff_area} (${inv.dropoff}).`,
    `Distance: ${inv.distance_km} km in ${inv.duration_mins} mins.`,
    `Total fare: ₹${inv.total_fare} (Ride: ₹${inv.ride_charge} + Platform: ₹${(inv.booking_fee ?? 0) + (inv.convenience_charges ?? 0)}).`,
    `Paid via ${inv.payment_mode}.`,
    `Captain: ${inv.captain_name}, Vehicle: ${inv.vehicle_number}.`,
    `Ride ID: ${inv.ride_id}.`,
  ].join(' ');
}
```

---

## UPLOAD PIPELINE (app/api/upload/route.ts)

```typescript
export const maxDuration = 60; // Vercel max for hobby tier on this route

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    // 1. Read PDF buffer
    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    // 2. Extract with DocStrange
    const extracted = await extractRapidoInvoice(pdfBuffer, file.name);

    // 3. Build embedding chunk text
    const chunkText = buildChunkText(extracted);

    // 4. Generate embedding
    const embedding = await generateEmbedding(chunkText);

    // 5. Insert into invoices table
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .insert({
        ride_id: extracted.ride_id,
        invoice_no: extracted.invoice_no,
        ride_date: extracted.ride_date,
        ride_time: extracted.ride_time,
        pickup: extracted.pickup,
        dropoff: extracted.dropoff,
        pickup_area: extracted.pickup_area,
        dropoff_area: extracted.dropoff_area,
        distance_km: extracted.distance_km,
        duration_mins: extracted.duration_mins,
        ride_charge: extracted.ride_charge,
        booking_fee: extracted.booking_fee,
        convenience_charges: extracted.convenience_charges,
        total_fare: extracted.total_fare,
        cgst_ride: extracted.cgst_ride,
        sgst_ride: extracted.sgst_ride,
        cgst_platform: extracted.cgst_platform,
        sgst_platform: extracted.sgst_platform,
        payment_mode: extracted.payment_mode,
        captain_name: extracted.captain_name,
        vehicle_number: extracted.vehicle_number,
        customer_name: extracted.customer_name,
        raw_markdown: extracted.raw_markdown,
        file_name: file.name,
      })
      .select()
      .single();

    if (invErr) {
      // Handle duplicate ride_id gracefully
      if (invErr.code === '23505') {
        return Response.json({ error: 'This invoice has already been uploaded.' }, { status: 409 });
      }
      throw invErr;
    }

    // 6. Insert embedding chunk
    await supabase.from('invoice_chunks').insert({
      invoice_id: invoice.id,
      chunk_text: chunkText,
      embedding,
      metadata: {
        ride_id: extracted.ride_id,
        ride_date: extracted.ride_date,
        pickup_area: extracted.pickup_area,
        dropoff_area: extracted.dropoff_area,
        total_fare: extracted.total_fare,
        payment_mode: extracted.payment_mode,
        captain_name: extracted.captain_name,
      },
    });

    return Response.json({ success: true, invoice });
  } catch (err: any) {
    console.error('Upload error:', err);
    return Response.json({ error: err.message ?? 'Upload failed' }, { status: 500 });
  }
}
```

---

## LANGGRAPH AGENT (lib/agent.ts)

Use createReactAgent from @langchain/langgraph/prebuilt.
Define 3 tools using the tool() helper from @langchain/core/tools with Zod schemas.

### Tool 1: vector_search
Input schema: { query: string }
Purpose: Semantic/qualitative questions — "rides near Gachibowli", "late night rides", 
"rides with Raja Rana"
Implementation: Generate embedding for query → call match_invoice_chunks RPC in Supabase 
→ return top 5 results with their metadata

### Tool 2: sql_query
Input schema: { intent: string }
Purpose: Aggregates and statistics
IMPORTANT: Do NOT allow arbitrary SQL. Map intent strings to pre-written safe queries only.

Supported intents and their queries:
- "total_spend" → SELECT SUM(total_fare) as total FROM invoices
- "ride_count" → SELECT COUNT(*) as count FROM invoices  
- "avg_fare" → SELECT ROUND(AVG(total_fare)::numeric, 2) as avg FROM invoices
- "avg_fare_per_km" → SELECT ROUND(AVG(total_fare / NULLIF(distance_km,0))::numeric, 2) as avg_per_km FROM invoices
- "total_gst" → SELECT ROUND(SUM(cgst_ride + sgst_ride + cgst_platform + sgst_platform)::numeric, 2) as total_gst FROM invoices
- "by_month" → SELECT TO_CHAR(ride_date,'YYYY-MM') as month, COUNT(*) as rides, SUM(total_fare) as spend FROM invoices GROUP BY 1 ORDER BY 1
- "by_payment_mode" → SELECT payment_mode, COUNT(*) as rides, SUM(total_fare) as spend FROM invoices GROUP BY 1 ORDER BY 2 DESC
- "top_routes" → SELECT pickup_area, dropoff_area, COUNT(*) as rides, ROUND(AVG(total_fare)::numeric,2) as avg_fare FROM invoices GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5
- "top_captains" → SELECT captain_name, COUNT(*) as rides, ROUND(AVG(total_fare)::numeric,2) as avg_fare FROM invoices GROUP BY 1 ORDER BY 2 DESC LIMIT 5
- "longest_rides" → SELECT ride_date, pickup_area, dropoff_area, distance_km, total_fare FROM invoices ORDER BY distance_km DESC LIMIT 5
- "most_expensive" → SELECT ride_date, pickup_area, dropoff_area, total_fare, payment_mode FROM invoices ORDER BY total_fare DESC LIMIT 5
- "fastest_rides" → SELECT ride_date, pickup_area, dropoff_area, duration_mins, distance_km FROM invoices ORDER BY duration_mins ASC LIMIT 5

If the intent doesn't match any key, return an error message listing available intents.

### Tool 3: get_invoice_detail
Input schema: { ride_id: string }
Purpose: Fetch full details of a specific invoice
Implementation: SELECT * FROM invoices WHERE ride_id = $1

### Agent System Prompt:
"You are RideIQ, an intelligent analyst for Rapido ride invoices. You have access to the 
user's complete invoice history. 

Rules:
- Use vector_search for semantic and qualitative questions (locations, captains, vibes)
- Use sql_query for numbers, totals, averages, rankings, and breakdowns
- Use get_invoice_detail when the user references a specific ride ID
- Always format currency as ₹X.XX
- When showing multiple results use markdown tables
- Be concise and friendly — you're a personal finance assistant for commutes
- If you use sql_query, always state what the query is computing before showing results"

### Graph setup:
const agent = createReactAgent({
  llm: new ChatOpenAI({ model: 'gpt-4o', temperature: 0 }),
  tools: [vectorSearchTool, sqlQueryTool, getInvoiceDetailTool],
  messageModifier: SYSTEM_PROMPT,
});

---

## AGENT STREAMING ROUTE (app/api/agent/route.ts)

```typescript
export const maxDuration = 60;

export async function POST(request: Request) {
  const { messages } = await request.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const eventStream = agent.streamEvents(
          { messages },
          { version: 'v2' }
        );

        for await (const event of eventStream) {
          // Stream LLM text tokens to client
          if (
            event.event === 'on_chat_model_stream' &&
            event.data?.chunk?.content
          ) {
            const text = event.data.chunk.content;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text })}\n\n`));
          }
          // Notify client when a tool is being called (for UI indicators)
          if (event.event === 'on_tool_start') {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_start', tool: event.name })}\n\n`
              )
            );
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

---

## FRONTEND PAGES

### Page 1: Landing / Upload (app/page.tsx)
- Clean dark-mode capable hero: "RideIQ — Ask anything about your Rapido rides"
- Subtitle: "Powered by Nanonets DocStrange OCR"
- Drag-and-drop PDF upload zone using react-dropzone + shadcn Card styling
- On drop: show filename + size + "Processing..." spinner
- After successful upload: show a preview card with extracted fields 
  (date, route, fare, captain) before dismissing
- Duplicate upload: show a yellow warning toast "Already uploaded"
- Navigation links to Dashboard and Chat in a simple top nav

### Page 2: Dashboard (app/dashboard/page.tsx)
- Top stats row — 4 shadcn Cards:
  - Total Spend (₹)
  - Total Rides
  - Avg Fare (₹)
  - Total GST Paid (₹) ← unique angle, impressive for demo
- Invoice data table using TanStack Table + shadcn styling
  Columns: Date | Time | From → To | Distance | Duration | Fare | Payment | Captain
- Filter bar: month picker (shadcn Select) + payment mode filter + search by area
- Sort by: fare, date, distance (column header click)
- Click any row → shadcn Sheet slides in with full invoice detail including all 
  tax breakdown fields
- "Ask AI about this ride" button in detail sheet → navigates to /chat with 
  ride_id pre-filled as first message

### Page 3: Chat (app/chat/page.tsx)
- Full-height chat layout, messages list + fixed input bar at bottom
- Streaming token rendering using EventSource reading from /api/agent
- Markdown rendering via react-markdown with tailwind-typography prose styling
- Tool call indicators between messages:
  - "🔍 Searching invoices semantically..." (vector_search)
  - "📊 Running query..." (sql_query)
  - "📄 Fetching ride details..." (get_invoice_detail)
- Empty state shows 6 suggested starter chips:
  - "How much did I spend this month?"
  - "Which route do I take most often?"
  - "What was my most expensive ride?"
  - "How much GST have I paid in total?"
  - "Which captain drove me the most?"
  - "Compare my cash vs UPI spend"
- Message history in React state (no DB persistence needed)
- Input: shadcn Textarea with Cmd+Enter to send

---

## ENV VARIABLES (.env.local.example)
OPENAI_API_KEY=
DOCSTRANGE_API_KEY=           # from docstrange.nanonets.com top-right menu
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # for server-side inserts

---

## PACKAGE.JSON DEPENDENCIES

```json
{
  "dependencies": {
    "next": "14.2.x",
    "@supabase/supabase-js": "^2",
    "@langchain/langgraph": "latest",
    "@langchain/openai": "latest",
    "@langchain/core": "latest",
    "openai": "^4",
    "react-dropzone": "^14",
    "react-markdown": "^9",
    "remark-gfm": "^4",
    "@tanstack/react-table": "^8",
    "zod": "^3",
    "tailwindcss": "^3",
    "tailwindcss-typography": "^0.5"
  }
}
```

Install shadcn/ui separately after init:
npx shadcn-ui@latest init
npx shadcn-ui@latest add card button input textarea select sheet table badge toast

---

## VERCEL DEPLOYMENT NOTES

- Set maxDuration = 60 on /api/upload/route.ts and /api/agent/route.ts
- Use Node runtime (not Edge) — LangGraph.js requires Node APIs
- Add all env variables in Vercel project settings
- Supabase: enable pgvector under Database → Extensions before first deploy
- No filesystem writes anywhere — all PDF bytes stay in memory as Buffer

---

## README (must be comprehensive — this is your portfolio piece)

Include:
1. Project overview with architecture diagram in Mermaid
2. Why DocStrange by Nanonets — call out that it ranks #1 on the IDP Leaderboard 
   above Gemini and Claude on document extraction benchmarks
3. How the 3-tool LangGraph ReAct agent works (diagram showing agent loop)
4. Setup instructions: Supabase SQL → env vars → npm install → npm run dev
5. Sample questions the agent can answer
6. Live demo link placeholder

---

## QUALITY BAR

- TypeScript strict mode throughout, no `any` except error handlers
- All API calls wrapped in try/catch with user-friendly error messages shown in UI
- Loading states on every async operation
- Duplicate invoice detection via unique constraint on ride_id
- Mobile responsive layout
- No mock or hardcoded data — everything wires to real APIs
- Console.warn (not throw) on partial OCR failures so one bad field doesn't 
  kill the whole upload

Build this completely and in order:
1. lib/types.ts
2. lib/supabase.ts
3. lib/docstrange.ts
4. lib/embeddings.ts
5. lib/agent.ts
6. app/api/upload/route.ts
7. app/api/invoices/route.ts
8. app/api/agent/route.ts
9. components/ (all)
10. app/page.tsx
11. app/dashboard/page.tsx
12. app/chat/page.tsx
13. README.md