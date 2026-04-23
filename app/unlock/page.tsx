"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UnlockPage(): JSX.Element {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Invalid password");
      }

      router.replace("/");
      router.refresh();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "Invalid password");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 border rounded-lg p-5">
        <p className="text-lg font-semibold">RideIQ Access</p>
        <p className="text-sm text-muted-foreground">Enter password to open the app.</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="w-full border rounded px-3 py-2 text-sm"
          required
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {isLoading ? "Checking..." : "Unlock"}
        </button>
      </form>
    </main>
  );
}
