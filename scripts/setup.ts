import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, monitorTarget } from "../src/lib/config";
import { loadHistory, saveHistory } from "./lib/history";
import { GitHub } from "./lib/github";
import { publish, updateReadme } from "./lib/publish";
import { historyFile, ROOT } from "./lib/repo";

/**
 * One-time (and re-runnable) preparation.
 *
 * Validates the config, creates the incident labels, checks that every
 * configured assignee can actually be assigned, and seeds a `history/<id>.yml`
 * for any monitor that has never been checked. Run it after editing
 * `upsite.config.yaml`; it never overwrites existing state.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const problems: string[] = [];

  console.log(`[upsite] ${config.site.name} — ${config.monitors.length} monitor(s)`);
  console.log(`[upsite] data repository: ${config.repository.owner}/${config.repository.name}`);

  for (const m of config.monitors) {
    const seeded = !existsSync(historyFile(m.id));
    const history = loadHistory(m);
    if (seeded) saveHistory(history);
    console.log(
      `  ${seeded ? "+" : "·"} ${m.id.padEnd(12)} ${monitorTarget(m)}` +
        `${m.paused ? "  (paused)" : ""}${m.secure ? "  (not published)" : ""}`,
    );
  }

  if (!config.notifications.slackWebhook) {
    console.log(
      "[upsite] no Slack webhook configured — set the SLACK_WEBHOOK_URL repository secret to enable notifications",
    );
  }

  const gh = GitHub.fromEnv(config.repository.owner, config.repository.name);
  if (gh) {
    await gh.ensureLabels(config.incidents.labels);

    const usable = await gh.filterAssignees(config.incidents.assignees);
    if (config.incidents.assignees.length > 0 && usable.length === 0) {
      problems.push(
        "none of the configured incident assignees can be assigned in this repository — " +
          "incidents will be opened unassigned",
      );
    }
  }

  // Give the site something to render before the first check lands.
  const { snapshot } = await publish(config);
  updateReadme(snapshot.monitors);
  console.log(`[upsite] wrote api/ and the README table under ${path.relative(process.cwd(), ROOT) || "."}`);

  for (const p of problems) console.warn(`[upsite] warning: ${p}`);
}

main().catch((err) => {
  console.error("[upsite] setup failed:", err);
  process.exit(1);
});
