import { Dashboard } from "@/components/dashboard";
import { isSecureConfigured, isUnlocked } from "@/lib/auth";
import { ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

// The snapshot changes on every check, so this page can never be static.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureEngine();

  const unlocked = await isUnlocked();

  // Server-render the first paint from the in-memory store; the client then
  // takes over via SSE and never polls.
  return (
    <Dashboard
      initial={store.snapshot({ includeSecure: unlocked })}
      secure={{ configured: isSecureConfigured(), unlocked }}
    />
  );
}
