import Link from "next/link";

export function TopNav(): JSX.Element {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-bold tracking-wide">
          RideIQ
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/" className="rounded-md px-2 py-1 hover:bg-muted">
            Upload
          </Link>
          <Link href="/dashboard" className="rounded-md px-2 py-1 hover:bg-muted">
            Dashboard
          </Link>
          <Link href="/chat" className="rounded-md px-2 py-1 hover:bg-muted">
            Chat
          </Link>
        </nav>
      </div>
    </header>
  );
}
