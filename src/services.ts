import { fetch } from "@tauri-apps/plugin-http";
import { secrets } from "./store";

export interface Row {
  label: string;
  detail?: string;
  tone?: "good" | "bad" | "warn";
}
export interface ServiceData {
  title: string;
  rows: Row[];
  error?: string;
  at: number;
}

export const serviceData = new Map<string, ServiceData>();

async function get(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const fetchers: Record<string, (key: string) => Promise<Row[]>> = {
  async github(key) {
    const h = { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "monu" };
    const [mine, review] = await Promise.all([
      get("https://api.github.com/search/issues?q=is:pr+is:open+author:@me&per_page=5", h),
      get("https://api.github.com/search/issues?q=is:pr+is:open+review-requested:@me&per_page=5", h),
    ]);
    const rows: Row[] = [{ label: `Open PRs: ${mine.total_count}  ·  Reviews requested: ${review.total_count}`, tone: review.total_count ? "warn" : "good" }];
    for (const p of mine.items ?? []) rows.push({ label: p.title, detail: String(p.repository_url).split("/").slice(-2).join("/") });
    for (const p of review.items ?? []) rows.push({ label: "Review: " + p.title, detail: String(p.repository_url).split("/").slice(-2).join("/"), tone: "warn" });
    return rows;
  },
  async vercel(key) {
    const j = await get("https://api.vercel.com/v6/deployments?limit=6", { authorization: `Bearer ${key}` });
    return (j.deployments ?? []).map((d: any) => ({
      label: d.name,
      detail: `${d.state ?? d.readyState} · ${new Date(d.created).toLocaleString()}`,
      tone: d.state === "READY" ? "good" : d.state === "ERROR" ? "bad" : "warn",
    }));
  },
  async stripe(key) {
    const h = { authorization: `Bearer ${key}` };
    const [bal, ch] = await Promise.all([get("https://api.stripe.com/v1/balance", h), get("https://api.stripe.com/v1/charges?limit=5", h)]);
    const money = (a: any) => `${(a.amount / 100).toFixed(2)} ${String(a.currency).toUpperCase()}`;
    const rows: Row[] = (bal.available ?? []).map((a: any) => ({ label: "Available: " + money(a), tone: "good" as const }));
    for (const c of ch.data ?? []) rows.push({ label: money(c), detail: `${c.status} · ${new Date(c.created * 1000).toLocaleString()}`, tone: c.status === "succeeded" ? "good" : "bad" });
    return rows;
  },
};

export async function refreshService(id: string, title: string): Promise<ServiceData> {
  const key = await secrets.get(id);
  let d: ServiceData;
  if (!key) d = { title, rows: [], error: "NO_KEY", at: Date.now() };
  else {
    try {
      d = { title, rows: await fetchers[id](key), at: Date.now() };
    } catch (e) {
      d = { title, rows: [], error: String((e as Error).message ?? e), at: Date.now() };
    }
  }
  serviceData.set(id, d);
  return d;
}

export const hasFetcher = (id: string) => id in fetchers;
