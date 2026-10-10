import { invoke } from "@tauri-apps/api/core";
import { state, saveSettings } from "./store";
import { recordEvent } from "./stats";

export interface Step {
  ts: number;
  tool: string;
  summary: string;
  add?: number;
  del?: number;
  diff?: { path: string; old: string; nw: string };
}
export type SState = "working" | "waiting" | "done" | "idle";
export interface Session {
  id: string;
  agent: string;
  cwd: string;
  project: string;
  state: SState;
  steps: Step[];
  prompt?: string;
  hwnd: number;
  started: number;
  updated: number;
  demo?: boolean;
}
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}
export interface Perm {
  id: string;
  sid: string;
  agent: string;
  tool: string;
  input: any;
  summary: string;
  questions?: Question[];
  hwnd: number;
  demo?: boolean;
}

export const sessions = new Map<string, Session>();
export const perms: Perm[] = [];

type Listener = (kind: "change" | "perm" | "finished" | "activity", data?: any) => void;
const listeners: Listener[] = [];
export const onSessions = (f: Listener) => listeners.push(f);
const emit: Listener = (k, d) => listeners.forEach((f) => f(k, d));

const lines = (s: unknown) => (typeof s === "string" && s.length ? s.split("\n").length : 0);
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function summarize(tool: string, i: any): { summary: string; add?: number; del?: number; diff?: Step["diff"] } {
  i = i ?? {};
  switch (tool) {
    case "Bash":
      return { summary: String(i.command ?? "").split("\n")[0].slice(0, 120) };
    case "Read":
      return { summary: base(String(i.file_path ?? "")) };
    case "Edit": {
      const add = lines(i.new_string), del = lines(i.old_string);
      return { summary: base(String(i.file_path ?? "")), add, del, diff: { path: String(i.file_path ?? ""), old: i.old_string ?? "", nw: i.new_string ?? "" } };
    }
    case "MultiEdit": {
      const eds: any[] = Array.isArray(i.edits) ? i.edits : [];
      return {
        summary: base(String(i.file_path ?? "")),
        add: eds.reduce((a, e) => a + lines(e.new_string), 0),
        del: eds.reduce((a, e) => a + lines(e.old_string), 0),
        diff: { path: String(i.file_path ?? ""), old: eds.map((e) => e.old_string).join("\n⋯\n"), nw: eds.map((e) => e.new_string).join("\n⋯\n") },
      };
    }
    case "Write":
      return { summary: base(String(i.file_path ?? "")), add: lines(i.content), del: 0, diff: { path: String(i.file_path ?? ""), old: "", nw: String(i.content ?? "") } };
    case "Grep":
    case "Glob":
      return { summary: String(i.pattern ?? "") };
    case "WebFetch":
      return { summary: String(i.url ?? "") };
    case "Task":
      return { summary: String(i.description ?? "") };
    default: {
      const s = typeof i === "object" ? JSON.stringify(i) : String(i);
      return { summary: s.slice(0, 100) };
    }
  }
}

function alwaysKey(tool: string, input: any): string {
  if (tool === "Bash") return "Bash:" + String(input?.command ?? "").trim().split(/\s+/)[0];
  return tool;
}

export async function respond(p: Perm, response: Record<string, unknown>) {
  const i = perms.findIndex((x) => x.id === p.id);
  if (i >= 0) perms.splice(i, 1);
  const s = sessions.get(p.sid);
  if (s) s.state = response.decision === "deny" ? "idle" : "working";
  if (!p.demo) await invoke("respond", { id: p.id, response }).catch(console.warn);
  emit("change");
}

export function allow(p: Perm, always = false, updatedInput?: unknown) {
  if (always) {
    const k = alwaysKey(p.tool, p.input);
    if (!state.settings.alwaysAllow.includes(k)) state.settings.alwaysAllow.push(k);
    saveSettings();
  }
  return respond(p, { decision: "allow", updated_input: updatedInput ?? null });
}
export const deny = (p: Perm) => respond(p, { decision: "deny", message: "Denied from Monu" });
export const askInTerminal = (p: Perm) => respond(p, { decision: "ask" });

export function cancelPerm(id: string) {
  const i = perms.findIndex((x) => x.id === id);
  if (i >= 0) {
    perms.splice(i, 1);
    emit("change");
  }
}

/** Handle one event coming from monu-hook (or the demo). */
export function handleAgentEvent(ev: any) {
  const pl = ev.payload ?? {};
  const agent: string = ev.agent ?? "claude";
  const event: string = pl.hook_event_name ?? "";
  const sid = String(pl.session_id ?? `${agent}-default`);
  const cwd = String(pl.cwd ?? "");
  const demo = !!ev.demo;

  let s = sessions.get(sid);
  if (!s) {
    s = { id: sid, agent, cwd, project: base(cwd) || agent, state: "idle", steps: [], hwnd: Number(ev.hwnd ?? 0), started: Date.now(), updated: Date.now(), demo };
    sessions.set(sid, s);
  }
  s.updated = Date.now();
  if (cwd) {
    s.cwd = cwd;
    s.project = base(cwd);
  }
  if (ev.hwnd) s.hwnd = Number(ev.hwnd);

  switch (event) {
    case "SessionStart":
      s.state = "idle";
      break;
    case "UserPromptSubmit":
      s.state = "working";
      s.prompt = String(pl.prompt ?? "").slice(0, 200);
      break;
    case "PreToolUse":
    case "PostToolUse": {
      if (event === "PostToolUse") break; // already logged on Pre
      const tool = String(pl.tool_name ?? "tool");
      const r = summarize(tool, pl.tool_input);
      s.state = "working";
      s.steps.push({ ts: Date.now(), tool, ...r });
      if (s.steps.length > 60) s.steps.shift();
      if (!demo) recordEvent({ kind: "tool", tool, agent, sid, project: s.project, path: r.diff?.path, add: r.add, del: r.del });
      emit("activity", { tool });
      break;
    }
    case "PermissionRequest": {
      const tool = String(pl.tool_name ?? "tool");
      const input = pl.tool_input ?? {};
      if (!demo) recordEvent({ kind: "perm", agent, sid, project: s.project });
      if (tool !== "AskUserQuestion" && state.settings.alwaysAllow.includes(alwaysKey(tool, input)) && ev.wait) {
        if (!demo) void invoke("respond", { id: ev.id, response: { decision: "allow", updated_input: null } });
        break;
      }
      s.state = "waiting";
      perms.push({
        id: String(ev.id),
        sid,
        agent,
        tool,
        input,
        summary: summarize(tool, input).summary,
        questions: tool === "AskUserQuestion" ? (input.questions as Question[]) : undefined,
        hwnd: s.hwnd,
        demo,
      });
      emit("perm", perms[perms.length - 1]);
      break;
    }
    case "Notification":
      if (/permission|waiting|input/i.test(String(pl.message ?? ""))) s.state = "waiting";
      break;
    case "Stop":
      s.state = "done";
      emit("finished", s);
      break;
    case "SessionEnd":
      if (!demo) recordEvent({ kind: "end", agent, sid, project: s.project });
      window.setTimeout(() => {
        sessions.delete(sid);
        emit("change");
      }, 4000);
      break;
  }
  if (!demo && event) recordEvent({ kind: "touch", agent, sid, project: s.project });
  emit("change");
}

export function removeDemoSessions() {
  for (const [k, s] of sessions) if (s.demo) sessions.delete(k);
  for (let i = perms.length - 1; i >= 0; i--) if (perms[i].demo) perms.splice(i, 1);
  emit("change");
}

export const anyWorking = () => [...sessions.values()].some((s) => s.state === "working");
