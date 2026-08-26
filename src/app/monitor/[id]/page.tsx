import { notFound } from "next/navigation";
import { MonitorDetail } from "@/components/monitor-detail";
import { buildMonitor, buildSource, publicMonitorIds } from "@/lib/build-data";
import { getConfig } from "@/lib/config";

/**
 * One page per public monitor, baked at build time. Secure monitors get no
 * route at all — there is no server here to authorise anyone against, so the
 * only honest way to keep one off the site is not to publish it.
 */
export function generateStaticParams() {
  return publicMonitorIds().map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getConfig();
  const monitor = config.monitors.find((m) => m.id === id && !m.secure);
  return {
    title: monitor ? `${monitor.name} — ${config.site.name}` : `Not found — ${config.site.name}`,
  };
}

export default async function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getConfig();
  const monitor = config.monitors.find((m) => m.id === id && !m.secure);
  if (!monitor) notFound();

  return (
    <MonitorDetail initial={buildMonitor(id)} source={buildSource(config)} />
  );
}
