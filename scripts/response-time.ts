import { loadConfig } from "../src/lib/config";
import {
  loadHistory,
  loadSamples,
  openWindow,
  sampleFromWindow,
  saveHistory,
  saveSamples,
} from "./lib/history";
import { publish } from "./lib/publish";

/**
 * The 6-hourly response-time recording.
 *
 * Every 5-minute check adds to a rolling window in `history/<id>.yml`; this
 * drains that window into one committed sample. Recording the mean of ~72
 * checks rather than a single probe is what makes the daily graphs readable —
 * a lone slow request no longer looks like a plateau.
 *
 * Draining is idempotent in the sense that matters: a run that finds an empty
 * window records nothing and leaves the series untouched.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const now = Date.now();
  let recorded = 0;

  for (const monitor of config.monitors) {
    const history = loadHistory(monitor);
    const sample = sampleFromWindow(history.window, now);

    if (!sample) {
      console.log(`[upsite] ${monitor.id}: no checks since the last recording — skipped`);
      continue;
    }

    const checks = history.window.n;
    const samples = loadSamples(monitor.id);
    samples.push(sample);
    saveSamples(monitor.id, samples, config.retention.recentChecks);

    history.window = openWindow(now);
    saveHistory(history);
    recorded++;

    console.log(
      `[upsite] ${monitor.id}: recorded ${sample.ms}ms (${sample.s}) — mean of ${checks} check(s)`,
    );
  }

  // The series the site charts changed, so the derived files have to follow.
  await publish(config);

  console.log(`[upsite] recorded response times for ${recorded} monitor(s)`);
}

main().catch((err) => {
  console.error("[upsite] response-time run failed:", err);
  process.exit(1);
});
