import { notFound } from "next/navigation";
import { isUnlocked } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";
import { MonitorDetail } from "@/components/monitor-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const monitor = getConfig().monitors.find((m) => m.id === id);
  const visible = monitor && (!monitor.secure || (await isUnlocked()));
  return { title: visible ? `${monitor.name} — Upsite` : "Not found — Upsite" };
}

export default async function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureEngine();

  const { id } = await params;
  const monitor = getConfig().monitors.find((m) => m.id === id);

  // Secure monitors are indistinguishable from missing ones until unlocked.
  if (!monitor || (monitor.secure && !(await isUnlocked()))) notFound();

  const incidents = store.getIncidents().filter((i) => i.monitorId === id);

  return <MonitorDetail initial={store.snapshotOf(monitor)} incidents={incidents} />;
}
