import { invoke } from "@tauri-apps/api/core";
import { app } from "./ctx";
import { state, saveSettings, secrets } from "./store";
import { t, LANGS } from "./i18n";
import { OUTFITS } from "./character";
import { PILLS, agentColor, agentName } from "./pills";
import { sessions, perms, allow, deny, askInTerminal, anyWorking, Perm, Session } from "./sessions";
import { PROVIDERS, streamChat, Msg } from "./chat";
import { serviceData, refreshService, hasFetcher } from "./services";
import { fakeReply } from "./demo";
import { lastWeek, recapRows, saveRecapImage, mondayOf } from "./stats";
import { play, setMuted } from "./sounds";

type Tab = "agents" | "chat" | "pills" | "settings";

export const ui = {
  tab: "agents" as Tab,
  open: new Set<string>(), // expanded session ids / diff keys
  sel: {} as Record<string, Record<number, string[]>>,
  msgs: [] as Msg[],
  busy: false,
  attach: null as null | { name: string; text: string },
  hooksPlan: null as null | { path: string; before: string; after: string; installed: boolean; remove: boolean },
  note: "",
  keyState: {} as Record<string, boolean>,
  abort: null as AbortController | null,
};

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function setTab(tab: Tab) {
  ui.tab = tab;
  if (tab === "pills") app.refreshServices();
  render(true);
}

const stateLabel = (s: Session) => t(s.state === "working" ? "working" : s.state === "waiting" ? "waiting" : s.state === "done" ? "done" : "idle");

function diffHtml(d: { old: string; nw: string }) {
  const rm = d.old ? d.old.split("\n").slice(0, 60).map((l) => `<span class="d">- ${esc(l)}</span>`).join("") : "";
  const ad = d.nw ? d.nw.split("\n").slice(0, 60).map((l) => `<span class="a">+ ${esc(l)}</span>`).join("") : "";
  return `<pre class="diff">${rm}${ad}</pre>`;
}

function permHtml(p: Perm) {
  const col = agentColor(p.agent);
  const diff = p.input && (p.tool === "Edit" || p.tool === "Write" || p.tool === "MultiEdit")
    ? diffHtml({ old: p.input.old_string ?? "", nw: p.input.new_string ?? p.input.content ?? "" })
    : "";
  if (p.questions?.length) {
    const qs = p.questions
      .map((q, qi) => {
        const chosen = ui.sel[p.id]?.[qi] ?? [];
        return `<div style="margin:8px 0"><div><b>${esc(q.header ?? "")}</b> ${esc(q.question)}</div>${q.options
          .map(
            (o) =>
              `<button class="btn opt ${chosen.includes(o.label) ? "on" : ""}" data-act="qopt" data-pid="${esc(p.id)}" data-qi="${qi}" data-label="${esc(o.label)}" data-multi="${q.multiSelect ? 1 : 0}">${esc(o.label)}${o.description ? `<span class="small"> · ${esc(o.description)}</span>` : ""}</button>`,
          )
          .join("")}</div>`;
      })
      .join("");
    return `<div class="card perm"><b style="color:${col}">${esc(agentName(p.agent))}</b> ${esc(t("answer"))}:${qs}
      <div class="row"><button class="btn pri" data-act="qsubmit" data-pid="${esc(p.id)}">${t("submit")}</button><button class="btn mut" data-act="term" data-pid="${esc(p.id)}">${t("terminal")}</button></div></div>`;
  }
  return `<div class="card perm"><b style="color:${col}">${esc(agentName(p.agent))}</b> ${t("wants_to")} <b>${esc(p.tool)}</b>
    <code class="cmd">${esc(p.summary)}</code>${diff}
    <div class="row"><button class="btn good" data-act="allow" data-pid="${esc(p.id)}">${t("allow")}</button>
    <button class="btn bad" data-act="deny" data-pid="${esc(p.id)}">${t("deny")}</button>
    <button class="btn" data-act="always" data-pid="${esc(p.id)}">${t("always")}</button>
    <button class="btn mut" data-act="term" data-pid="${esc(p.id)}">${t("terminal")}</button></div></div>`;
}

function sessionHtml(s: Session) {
  const open = ui.open.has(s.id);
  const steps = open
    ? `<ul class="steps">${s.steps
        .slice(-14)
        .reverse()
        .map((st, i) => {
          const key = `${s.id}:${st.ts}:${i}`;
          const cnt = st.add !== undefined ? ` <span class="add">+${st.add}</span> <span class="del">−${st.del ?? 0}</span>` : "";
          const dOpen = st.diff && ui.open.has(key);
          return `<li ${st.diff ? `data-act="diff" data-key="${esc(key)}" style="cursor:pointer"` : ""}><b>${esc(st.tool)}</b> ${esc(st.summary)}${cnt}${dOpen ? diffHtml(st.diff!) : ""}</li>`;
        })
        .join("")}</ul>${s.prompt ? `<div class="small" style="margin:6px 0 0 20px">“${esc(s.prompt)}”</div>` : ""}
        ${s.hwnd ? `<div class="row" style="margin-left:20px"><button class="btn" data-act="focus" data-hwnd="${s.hwnd}">Open terminal</button></div>` : ""}`
    : "";
  return `<div class="sess" data-act="sess" data-sid="${esc(s.id)}"><i class="dot" style="background:${agentColor(s.agent)}"></i>
    <div class="m"><b>${esc(agentName(s.agent))}</b> <em>${esc(s.project)}</em><span>${esc(s.steps[s.steps.length - 1] ? s.steps[s.steps.length - 1].tool + " " + s.steps[s.steps.length - 1].summary : s.prompt ?? "")}</span>${steps}</div>
    <em>${stateLabel(s)}</em></div>`;
}

function agentsHtml() {
  const list = [...sessions.values()].sort((a, b) => b.updated - a.updated);
  const isMonday = new Date().getDay() === 1 || new Date().getDay() === 2;
  const recap =
    lastWeek && isMonday && lastWeek.start !== mondayOf()
      ? `<div class="card"><b>${t("recap")}</b> <span class="small">${esc(lastWeek.start)}</span>
         ${recapRows(lastWeek, state.settings.recapProjects).map(([k, v]) => `<div class="row" style="justify-content:space-between;margin:2px 0"><span class="small">${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}
         <div class="row"><button class="btn" data-act="recap">${t("share_recap")}</button></div>${ui.note ? `<div class="small">${esc(ui.note)}</div>` : ""}</div>`
      : "";
  return (
    recap +
    perms.map(permHtml).join("") +
    (list.length ? `<h4>${t("sessions")}</h4>` + list.map(sessionHtml).join("") : `<div class="none">${t("no_agents")}</div>`)
  );
}

function chatHtml() {
  const s = state.settings;
  const prov = PROVIDERS.find((p) => p.id === s.provider)!;
  return `<div class="chat">
    <div class="row"><select data-set="provider" style="width:auto">${PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === s.provider ? "selected" : ""}>${p.name}</option>`).join("")}</select>
    <input type="text" data-set="model" value="${esc(s.models[prov.id])}" style="flex:1" aria-label="${t("model")}"></div>
    ${ui.attach ? `<div><span class="chip">📎 ${esc(ui.attach.name)} <a data-act="unattach" style="cursor:pointer">×</a></span></div>` : ""}
    <div class="msgs" id="msgs">${ui.msgs.map((m) => `<div class="bub ${m.role === "user" ? "u" : "a"}">${esc(m.content)}</div>`).join("")}</div>
    <div class="row"><textarea id="chatin" rows="2" placeholder="${t("placeholder")}"></textarea></div>
    <div class="row"><button class="btn pri" data-act="chatsend">${t("send")}</button><button class="btn" data-act="chatclear">${t("clear")}</button><span class="small" id="chaterr"></span></div>
  </div>`;
}

function mediaHtml() {
  const m = app.media;
  if (!m || !m.title) return `<div class="none" id="media">${t("nothing_playing")}</div>`;
  const pct = m.duration > 0 ? Math.min(100, (m.position / m.duration) * 100) : 0;
  return `<div class="card" id="media"><b>${esc(m.title)}</b><div class="small">${esc(m.artist)} · ${esc(m.source.split("!")[0].replace(/\.exe$/i, ""))}</div>
    <div class="bar" style="margin:8px 0"><i style="width:${pct}%"></i></div>
    <div class="row"><button class="btn" data-act="media" data-cmd="prev">⏮</button><button class="btn pri" data-act="media" data-cmd="toggle">${m.playing ? "⏸" : "▶"}</button><button class="btn" data-act="media" data-cmd="next">⏭</button></div></div>`;
}
export function updateMedia() {
  const el = document.getElementById("media");
  if (el && ui.tab === "pills") el.outerHTML = mediaHtml();
  else if (!el && ui.tab === "pills") render();
}

function pillsHtml() {
  const s = state.settings;
  const groups: [string, string][] = [["agent", "Agents"], ["ai", "AI"], ["service", "Services"], ["media", "Media"]];
  let out = `<h4>${t("active_pills")}</h4>`;
  for (const [cat, label] of groups) {
    out += `<h4>${label}</h4>`;
    for (const p of PILLS.filter((x) => x.category === cat)) {
      const on = s.pills.includes(p.id);
      out += `<label class="sw"><input type="checkbox" data-act="pilltoggle" data-id="${p.id}" ${on ? "checked" : ""}><i style="width:10px;height:10px;border-radius:50%;background:${p.color};display:inline-block"></i> ${esc(p.name)}</label>`;
      if (on && p.secret) {
        const stored = ui.keyState[p.secret];
        out += `<div class="row" style="margin-left:26px"><input type="password" id="key-${p.secret}" placeholder="${stored ? "•••••••• (" + t("connected") + ")" : "API key / token"}" class="grow">
          <button class="btn" data-act="keysave" data-name="${p.secret}">${t("save")}</button>${stored ? `<button class="btn" data-act="keydel" data-name="${p.secret}">${t("remove")}</button>` : ""}</div>
          <div class="small" style="margin-left:26px">${t("key_stored")}</div>`;
        if (hasFetcher(p.id)) {
          const d = serviceData.get(p.id);
          if (d) {
            out += `<div class="card" style="margin-left:26px">${
              d.error
                ? `<span class="small">${d.error === "NO_KEY" ? "—" : esc(d.error)}</span>`
                : d.rows.map((r) => `<div class="tone-${r.tone ?? ""}">${esc(r.label)}${r.detail ? ` <span class="small">${esc(r.detail)}</span>` : ""}</div>`).join("") || `<span class="small">—</span>`
            }</div>`;
          }
        }
      }
      if (on && p.id === "ollama") out += `<div class="row" style="margin-left:26px"><input type="text" data-set="ollamaUrl" value="${esc(s.ollamaUrl)}"></div>`;
      if (on && p.id === "lmstudio") out += `<div class="row" style="margin-left:26px"><input type="text" data-set="lmUrl" value="${esc(s.lmUrl)}"></div>`;
      if (on && p.id === "spotify") out += `<div style="margin-left:26px">${mediaHtml()}</div>`;
    }
  }
  return out;
}

function settingsHtml() {
  const s = state.settings;
  const sw = (label: string, key: string, on: boolean) => `<label class="sw"><input type="checkbox" data-act="toggle" data-key="${key}" ${on ? "checked" : ""}> ${esc(label)}</label>`;
  const plan = ui.hooksPlan
    ? `<div class="card"><div class="small">${t("review_changes")} <code>${esc(ui.hooksPlan.path)}</code></div><pre class="diff" style="max-height:180px">${esc(ui.hooksPlan.after)}</pre>
       <div class="row"><button class="btn pri" data-act="hooksapply">${t("apply")}</button><button class="btn" data-act="hookscancel">${t("cancel")}</button></div></div>`
    : "";
  return `
  <h4>${t("language")}</h4>
  <select data-set="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === s.lang ? "selected" : ""}>${v.name}</option>`).join("")}</select>

  <h4>Claude Code</h4>
  <div class="row"><button class="btn pri" data-act="hooksplan" data-remove="0">${t("install_hooks")}</button><button class="btn" data-act="hooksplan" data-remove="1">${t("remove_hooks")}</button></div>
  ${plan}${ui.note ? `<div class="small">${esc(ui.note)}</div>` : ""}
  <div class="small">Other agents: run <span class="kbd">monu-hook.exe --agent NAME</span> from their hook config (add <span class="kbd">--wait</span> for approvals).</div>

  <h4>${t("sound")}</h4>
  ${sw(t("muted"), "muted", s.muted)}
  <div class="row"><button class="btn" data-act="sounds">${t("sounds_folder")}</button></div>

  <h4>Monu</h4>
  <div class="row"><label>${t("colour")}<input type="range" min="0" max="360" value="${s.hue}" data-set="hue" style="width:100%"></label>
  <label>${t("wardrobe")}<select data-set="outfit"><option value="-1" ${s.outfit === -1 ? "selected" : ""}>Auto (seasonal)</option>${OUTFITS.map((o, i) => `<option value="${i}" ${s.outfit === i ? "selected" : ""}>${o}</option>`).join("")}</select></label></div>
  <div class="row"><button class="btn" data-act="buddy">${app.buddy ? t("recall") : t("desktop")}</button>
  <button class="btn ${state.demo ? "bad" : ""}" data-act="demo">${state.demo ? t("stop_demo") : t("demo")}</button></div>

  <h4>General</h4>
  ${sw(t("autostart"), "autostart", app.autostart)}
  ${sw(t("on_hover"), "openOnHover", s.openOnHover)}
  ${sw(t("auto_collapse"), "autoCollapse", s.autoCollapse)}
  ${sw(t("hide_fs"), "hideFullscreen", s.hideFullscreen)}
  ${sw(t("follow"), "followMouse", s.followMouse)}
  ${!s.followMouse ? `<div class="row"><label>${t("screen")}<select data-set="screen"><option value="-1" ${s.screen < 0 ? "selected" : ""}>Primary</option>${app.monitors.map((m, i) => `<option value="${i}" ${s.screen === i ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label></div>` : ""}
  ${sw(t("include_projects"), "recapProjects", s.recapProjects)}

  <h4>${t("shortcuts")}</h4>
  ${Object.entries(s.shortcuts).map(([k, v]) => `<div class="row"><span style="width:80px">${k}</span><input type="text" data-sc="${k}" value="${esc(v)}" class="grow"></div>`).join("")}
  <div class="small">e.g. CommandOrControl+Alt+M</div>`;
}

let renderQueued = false;
export function render(force = false) {
  if (renderQueued && !force) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    paint(force);
  });
}

function paint(force: boolean) {
  const nwork = anyWorking();
  $("#st").textContent = perms.length ? t("needs_ok") : nwork ? t("working") : t("quiet");
  $("#dots").innerHTML = [...sessions.values()].map((s) => `<i class="${s.state === "working" ? "work" : ""}" style="background:${agentColor(s.agent)}"></i>`).join("");
  const tabs: [Tab, string][] = [["agents", t("tab_agents")], ["chat", t("tab_chat")], ["pills", t("tab_pills")], ["settings", t("tab_settings")]];
  $("#tabs").innerHTML = tabs
    .map(([id, label]) => `<button data-act="tab" data-tab="${id}" class="${ui.tab === id ? "on" : ""}">${label}${id === "agents" && perms.length ? `<span class="badge">${perms.length}</span>` : ""}</button>`)
    .join("");

  const body = $("#body");
  const ae = document.activeElement as HTMLElement | null;
  if (!force && ae && body.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return; // never steal typing focus
  const keepIn = (document.getElementById("chatin") as HTMLTextAreaElement | null)?.value ?? "";
  const top = body.scrollTop;
  body.innerHTML = ui.tab === "agents" ? agentsHtml() : ui.tab === "chat" ? chatHtml() : ui.tab === "pills" ? pillsHtml() : settingsHtml();
  body.scrollTop = top;
  const cin = document.getElementById("chatin") as HTMLTextAreaElement | null;
  if (cin) cin.value = keepIn;
  const m = document.getElementById("msgs");
  if (m) m.scrollTop = m.scrollHeight;
}

// ---------------- chat ----------------
export async function sendChat() {
  if (ui.busy) return;
  const inp = document.getElementById("chatin") as HTMLTextAreaElement | null;
  const text = inp?.value.trim();
  if (!text) return;
  const err = document.getElementById("chaterr");
  if (err) err.textContent = "";
  const content = ui.attach ? `${text}\n\n--- ${ui.attach.name} ---\n${ui.attach.text}` : text;
  ui.msgs.push({ role: "user", content: text });
  ui.msgs.push({ role: "assistant", content: "" });
  const history: Msg[] = ui.msgs.slice(0, -1).map((m, i, a) => (i === a.length - 1 ? { ...m, content } : m));
  ui.attach = null;
  ui.busy = true;
  if (inp) inp.value = "";
  play("send");
  render(true);
  ui.abort = new AbortController();
  const idx = ui.msgs.length - 1;
  try {
    const gen = state.demo ? fakeReply() : streamChat(state.settings.provider, history, ui.abort.signal);
    for await (const chunk of gen) {
      ui.msgs[idx].content += chunk;
      const bubs = document.querySelectorAll("#msgs .bub.a");
      const last = bubs[bubs.length - 1];
      if (last) last.textContent = ui.msgs[idx].content;
      const m = document.getElementById("msgs");
      if (m) m.scrollTop = m.scrollHeight;
    }
    play("message");
    app.mood("happy", 1);
  } catch (e) {
    const msg = (e as Error).message;
    ui.msgs.pop();
    if (msg === "NO_KEY") ui.msgs.push({ role: "assistant", content: t("no_key") });
    else ui.msgs.push({ role: "assistant", content: "⚠ " + msg });
    play("error");
    render(true);
  } finally {
    ui.busy = false;
  }
}

export async function attachFile(f: File) {
  if (f.size > 200_000) {
    ui.attach = { name: f.name, text: "(file too large to attach: max 200 KB)" };
  } else {
    ui.attach = { name: f.name, text: await f.text() };
  }
  ui.tab = "chat";
  render(true);
}

// ---------------- events ----------------
export async function refreshKeyStates() {
  for (const p of PILLS) if (p.secret) ui.keyState[p.secret] = !!(await secrets.get(p.secret));
}

export function wireUi() {
  const body = $("#body");
  const root = $("#isl");

  root.addEventListener("click", async (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset.act!;
    const perm = () => perms.find((p) => p.id === el.dataset.pid);
    switch (act) {
      case "tab":
        play("tick");
        setTab(el.dataset.tab as Tab);
        return;
      case "sess": {
        const id = el.dataset.sid!;
        ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id);
        render(true);
        return;
      }
      case "diff": {
        const k = el.dataset.key!;
        ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k);
        ev.stopPropagation();
        render(true);
        return;
      }
      case "focus":
        ev.stopPropagation();
        await invoke("focus_hwnd", { h: Number(el.dataset.hwnd) });
        return;
      case "allow": { const p = perm(); if (p) { play("allow"); app.mood("happy", 0.8); await allow(p); } return; }
      case "always": { const p = perm(); if (p) { play("always"); app.mood("happy", 0.8); await allow(p, true); } return; }
      case "deny": { const p = perm(); if (p) { play("deny"); app.mood("annoyed", 0.8); await deny(p); } return; }
      case "term": { const p = perm(); if (p) await askInTerminal(p); return; }
      case "qopt": {
        const pid = el.dataset.pid!, qi = Number(el.dataset.qi), label = el.dataset.label!;
        const cur = (ui.sel[pid] ??= {});
        const arr = cur[qi] ?? [];
        cur[qi] = el.dataset.multi === "1" ? (arr.includes(label) ? arr.filter((x) => x !== label) : [...arr, label]) : [label];
        render(true);
        return;
      }
      case "qsubmit": {
        const p = perm();
        if (!p || !p.questions) return;
        const answers: Record<string, string> = {};
        p.questions.forEach((q, qi) => (answers[q.question] = (ui.sel[p.id]?.[qi] ?? []).join(", ")));
        play("allow");
        await allow(p, false, { ...p.input, answers });
        return;
      }
      case "unattach": ui.attach = null; render(true); return;
      case "chatsend": void sendChat(); return;
      case "chatclear": ui.msgs = []; ui.abort?.abort(); ui.busy = false; render(true); return;
      case "media":
        await invoke("media_cmd", { cmd: el.dataset.cmd }).catch(() => {});
        return;
      case "keysave": {
        const name = el.dataset.name!;
        const inp = document.getElementById(`key-${name}`) as HTMLInputElement;
        if (inp?.value.trim()) {
          await secrets.set(name, inp.value.trim());
          ui.keyState[name] = true;
          play("allow");
          app.refreshServices();
          render(true);
        }
        return;
      }
      case "keydel":
        await secrets.del(el.dataset.name!);
        ui.keyState[el.dataset.name!] = false;
        serviceData.delete(el.dataset.name!);
        render(true);
        return;
      case "hooksplan": {
        const remove = el.dataset.remove === "1";
        try {
          const plan = await invoke<{ path: string; before: string; after: string; installed: boolean }>("hooks_plan", { agent: "claude", remove });
          ui.hooksPlan = { ...plan, remove };
          ui.note = "";
        } catch (e) { ui.note = String(e); }
        render(true);
        return;
      }
      case "hooksapply":
        try {
          await invoke("hooks_apply", { agent: "claude", remove: ui.hooksPlan?.remove ?? false });
          ui.note = ui.hooksPlan?.remove ? t("hooks_removed") : t("hooks_done");
          play("allow");
        } catch (e) { ui.note = String(e); play("error"); }
        ui.hooksPlan = null;
        render(true);
        return;
      case "hookscancel": ui.hooksPlan = null; render(true); return;
      case "sounds": await invoke("open_sounds_folder"); return;
      case "buddy": app.toggleBuddy(); setTimeout(() => render(true), 300); return;
      case "demo": state.demo ? app.stopDemo() : app.startDemo(); render(true); return;
      case "recap":
        if (lastWeek) {
          try { ui.note = await saveRecapImage(lastWeek, state.settings.recapProjects); play("finish"); } catch (e) { ui.note = String(e); }
          render(true);
        }
        return;
    }
  });

  // checkboxes
  root.addEventListener("change", async (ev) => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement;
    const s = state.settings;
    if (el.dataset.act === "pilltoggle") {
      const id = el.dataset.id!;
      s.pills = (el as HTMLInputElement).checked ? [...new Set([...s.pills, id])] : s.pills.filter((p) => p !== id);
      saveSettings();
      if ((el as HTMLInputElement).checked) app.refreshServices();
      render(true);
      return;
    }
    if (el.dataset.act === "toggle") {
      const key = el.dataset.key!;
      const on = (el as HTMLInputElement).checked;
      if (key === "autostart") { await app.setAutostart(on); render(true); return; }
      (s as any)[key] = on;
      if (key === "muted") { setMuted(on); play(on ? "mute" : "unmute"); }
      saveSettings();
      app.applyOptions();
      render(true);
      return;
    }
    const k = el.dataset.set;
    if (!k) return;
    if (k === "provider") s.provider = el.value;
    else if (k === "model") s.models[s.provider] = el.value;
    else if (k === "lang") s.lang = el.value;
    else if (k === "hue") s.hue = Number(el.value);
    else if (k === "outfit") s.outfit = Number(el.value);
    else if (k === "screen") s.screen = Number(el.value);
    else if (k === "ollamaUrl" || k === "lmUrl") (s as any)[k] = el.value;
    saveSettings();
    app.applyStyle();
    app.applyOptions();
    render(true);
  });
  root.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.set === "hue") {
      state.settings.hue = Number(el.value);
      app.applyStyle();
    }
    if (el.dataset.sc) {
      state.settings.shortcuts[el.dataset.sc] = el.value;
    }
  });
  root.addEventListener("focusout", (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset?.sc) {
      saveSettings();
      app.bindShortcuts();
    }
    if (el.dataset?.set === "hue") saveSettings();
  });
  body.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if ((e.target as HTMLElement).id === "chatin" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  });

  // drop a file on the island: Monu swallows it
  root.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    app.setIsland("home");
    app.mood("box", 2);
    app.monu?.jump();
    play("swallow");
    if (f) setTimeout(() => void attachFile(f), 1200);
  });
}

export { refreshService };
