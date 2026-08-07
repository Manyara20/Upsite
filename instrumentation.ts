/**
 * Next runs this once per server process, before any request is handled —
 * which is exactly the hook Upsite needs to boot its scheduler. Without a
 * database or an external cron, this is what makes the platform self-driving.
 */
export async function register(): Promise<void> {
  // Skip the edge runtime: the engine needs the filesystem and raw sockets.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Opt-out for CI or `next build`, where booting a scheduler is pointless.
  if (process.env.UPSITE_DISABLE_ENGINE === "1") {
    console.log("[upsite] engine disabled via UPSITE_DISABLE_ENGINE");
    return;
  }

  const { engine } = await import("./src/lib/engine");

  try {
    await engine.start();
  } catch (err) {
    // A bad config should be loud and obvious, not a silent no-op dashboard.
    console.error("[upsite] engine failed to start:", err);
  }
}
