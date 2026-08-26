import { loadConfig } from "../src/lib/config";
import { describeFleet, publish, updateReadme } from "./lib/publish";

/**
 * Rebuilds everything derived — `api/**` and the README table — from what is
 * already committed under `history/`. Runs on a schedule as a self-heal, and
 * by hand after editing `upsite.config.yaml`, so a newly added or renamed
 * monitor shows up without waiting for it to fail.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { snapshot } = await publish(config);
  const changed = updateReadme(snapshot.monitors);

  console.log(`[upsite] ${describeFleet(snapshot)}`);
  console.log(`[upsite] rewrote api/ for ${snapshot.monitors.length} public monitor(s)`);
  if (changed) console.log("[upsite] README status table updated");
}

main().catch((err) => {
  console.error("[upsite] summary run failed:", err);
  process.exit(1);
});
