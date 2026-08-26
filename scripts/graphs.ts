import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/lib/config";
import { loadSamples } from "./lib/history";
import { responseTimeGraph } from "./lib/graph";
import { ensureDir, GRAPHS_DIR } from "./lib/repo";

/**
 * The daily graph run.
 *
 * Redraws every monitor's response-time graph from the committed samples.
 * Nothing here reads the network or the previous graphs — the SVGs are pure
 * output, so a bad render is fixed by running this again.
 *
 * Secure monitors are skipped: a graph in `graphs/` is a public file.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  ensureDir(GRAPHS_DIR);

  let drawn = 0;
  for (const monitor of config.monitors) {
    if (monitor.secure) continue;

    const samples = loadSamples(monitor.id);
    const svg = responseTimeGraph({
      name: `${monitor.name} — response time`,
      samples,
      degradedMs: monitor.degradedMs,
    });

    writeFileSync(path.join(GRAPHS_DIR, `${monitor.id}.svg`), svg);
    drawn++;
    console.log(`[upsite] drew graphs/${monitor.id}.svg from ${samples.length} sample(s)`);
  }

  console.log(`[upsite] ${drawn} graph(s) up to date`);
}

main().catch((err) => {
  console.error("[upsite] graph run failed:", err);
  process.exit(1);
});
