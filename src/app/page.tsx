import { Dashboard } from "@/components/dashboard";
import { buildSnapshot, buildSource } from "@/lib/build-data";
import { getConfig } from "@/lib/config";

/**
 * A static export: there is no server to render against, so the page is built
 * once with whatever the uptime workflow had committed at that moment and the
 * client refreshes it from the GitHub API on load.
 */
export default function HomePage() {
  const config = getConfig();

  return (
    <Dashboard
      initial={buildSnapshot()}
      source={buildSource(config)}
      incidentLabels={config.incidents.labels}
      hasProtected={config.monitors.some((m) => m.secure)}
    />
  );
}
