import { getJson, setJson, state } from "./store";
import { t } from "./i18n";
import { Monu } from "./character";
import { invoke } from "@tauri-apps/api/core";

export interface Week {
  start: string; // ISO date of Monday
  sessions: string[];
  files: string[];
  add: number;
  del: number;
  commands: number;
  perms: number;
  agents: Record<string, number>;
  projects: Record<string, number>;
  days: Record<string, number>; // ms of coding per ISO day
  codingMs: number;
  longest: number;
  firstSeen: Record<string, number>;
  lastTouch: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function mondayOf(d = new Date()): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return iso(x);
}
const blank = (start: string): Week => ({ start, sessions: [], files: [], add: 0, del: 0, commands: 0, perms: 0, agents: {}, projects: {}, days: {}, codingMs: 0, longest: 0, firstSeen: {}, lastTouch: 0 });

let cur: Week = blank(mondayOf());
export let lastWeek: Week | null = null;

export async function loadStats() {
  const saved = await getJson<Week>("stats");
  const last = await getJson<Week>("recap");
  if (last) lastWeek = last;
  if (saved) {
    if (saved.start === mondayOf()) cur = saved;
    else {
      // New week: archive the previous one for the Monday recap.
      lastWeek = saved;
      await setJson("recap", saved);
      cur = blank(mondayOf());
    }
  }
}

let saveT: number | undefined;
function persist() {
  clearTimeout(saveT);
  saveT = window.setTimeout(() => setJson("stats", cur), 2000);
}

export function recordEvent(e: { kind: string; tool?: string; agent: string; sid: string; project: string; path?: string; add?: number; del?: number }) {
  if (state.demo) return;
  const now = Date.now();
  if (e.kind === "touch") {
    if (cur.lastTouch && now - cur.lastTouch < 5 * 60_000) {
      const gap = now - cur.lastTouch;
      cur.codingMs += gap;
      const day = iso(new Date());
      cur.days[day] = (cur.days[day] ?? 0) + gap;
    }
    cur.lastTouch = now;
    if (!cur.sessions.includes(e.sid)) {
      cur.sessions.push(e.sid);
      cur.agents[e.agent] = (cur.agents[e.agent] ?? 0) + 1;
      cur.projects[e.project] = (cur.projects[e.project] ?? 0) + 1;
      cur.firstSeen[e.sid] = now;
    }
    const len = now - (cur.firstSeen[e.sid] ?? now);
    if (len > cur.longest) cur.longest = len;
  } else if (e.kind === "tool") {
    if (e.tool === "Bash") cur.commands++;
    if (e.path && !cur.files.includes(e.path)) cur.files.push(e.path);
    cur.add += e.add ?? 0;
    cur.del += e.del ?? 0;
  } else if (e.kind === "perm") cur.perms++;
  persist();
}

const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "–";
const hm = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;

export function recapRows(w: Week, withProjects: boolean): [string, string][] {
  const busiest = Object.entries(w.days).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "–";
  return [
    [t("coding_time"), hm(w.codingMs)],
    [t("sessions"), String(w.sessions.length)],
    [t("files"), String(w.files.length)],
    [t("lines"), `+${w.add} −${w.del}`],
    [t("commands"), String(w.commands)],
    [t("permissions"), String(w.perms)],
    [t("top_agent"), top(w.agents)],
    ...(withProjects ? ([[t("top_project"), top(w.projects)]] as [string, string][]) : []),
    [t("busiest"), busiest],
    [t("longest"), hm(w.longest)],
  ];
}

/** Renders a 1080×1920 recap image with Monu, saves it to Pictures and returns the path. */
export async function saveRecapImage(w: Week, withProjects: boolean): Promise<string> {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 1920);
  grad.addColorStop(0, "#1a1240");
  grad.addColorStop(1, "#0b0b16");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1080, 1920);
  const tmp = document.createElement("canvas");
  tmp.style.cssText = "position:fixed;left:-999px;top:-999px;width:160px;height:160px";
  document.body.appendChild(tmp);
  const m = new Monu(tmp);
  m.hue = state.settings.hue;
  m.outfit = state.settings.outfit < 0 ? 0 : state.settings.outfit;
  m.mood("happy", 5);
  // render a few frames so spring/blink state settles, then grab it
  m.start();
  await new Promise((r) => setTimeout(r, 120));
  m.stop();
  g.drawImage(tmp, 340, 140, 400, 400);
  tmp.remove();
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.font = "700 64px 'Segoe UI', sans-serif";
  g.fillText(t("last_week"), 540, 640);
  g.font = "400 34px 'Segoe UI', sans-serif";
  g.fillStyle = "#9aa1b0";
  g.fillText(w.start, 540, 700);
  g.textAlign = "left";
  let y = 820;
  for (const [k, v] of recapRows(w, withProjects)) {
    g.fillStyle = "#9aa1b0";
    g.font = "400 38px 'Segoe UI', sans-serif";
    g.fillText(k, 120, y);
    g.fillStyle = "#fff";
    g.font = "700 46px 'Segoe UI', sans-serif";
    g.textAlign = "right";
    g.fillText(v, 960, y);
    g.textAlign = "left";
    g.fillStyle = "#ffffff18";
    g.fillRect(120, y + 24, 840, 2);
    y += 96;
  }
  g.fillStyle = "#7c5cff";
  g.textAlign = "center";
  g.font = "700 40px 'Segoe UI', sans-serif";
  g.fillText("Monu", 540, 1840);
  return invoke<string>("save_png", { name: `monu-recap-${w.start}`, b64: c.toDataURL("image/png") });
}
