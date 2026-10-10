import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Monu, Mood, seasonalOutfit, OUTFITS } from "./character";
import { app, Island } from "./ctx";
import { state, loadSettings, saveSettings } from "./store";
import { loadCustomSounds, play, setMuted, isMuted } from "./sounds";
import { handleAgentEvent, cancelPerm, onSessions, perms, anyWorking, allow, deny, sessions } from "./sessions";
import { loadStats } from "./stats";
import { startDemo, stopDemo } from "./demo";
import { refreshService } from "./services";
import { PILLS } from "./pills";
import { render, setTab, wireUi, updateMedia, refreshKeyStates, ui } from "./ui";
import { t } from "./i18n";

const isl = document.getElementById("isl") as HTMLElement;
let hideTimer = 0;
let hoverTimer = 0;
let inside = false;

// ---------- island state machine: hid -> peek -> home ----------
function setIsland(s: Island) {
  if (app.island === s) return;
  const prev = app.island;
  app.island = s;
  isl.className = s;
  if (s === "peek" && prev === "hid") play("peek");
  if (s === "home") play("open");
  if (s === "hid" && prev !== "hid") play("close");
  render(true);
}
app.setIsland = setIsland;

function hasWork() {
  return perms.length > 0;
}
function scheduleCollapse() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (inside || hasWork()) return;
    if (app.island === "home" && !state.settings.autoCollapse) return;
    setIsland("peek");
    hideTimer = window.setTimeout(() => {
      if (!inside && !hasWork() && !anyWorking()) setIsland("hid");
    }, 900);
  }, 1100);
}

// ---------- Monu ----------
const monu = new Monu(document.getElementById("mo") as HTMLCanvasElement);
app.monu = monu;
app.mood = (m: Mood, sec: number) => {
  monu.mood(m, sec);
  void emit("monu-mood", { mood: m, sec });
};
app.applyStyle = () => {
  const s = state.settings;
  monu.hue = s.hue;
  monu.outfit = s.outfit < 0 ? seasonalOutfit() : s.outfit;
  void emit("monu-style", { hue: s.hue, outfit: s.outfit });
};
app.applyOptions = () => {
  const s = state.settings;
  void invoke("set_options", { hideFullscreen: s.hideFullscreen, followMouse: s.followMouse, screen: s.screen });
};
app.setMute = (m) => {
  state.settings.muted = m;
  setMuted(m);
  saveSettings();
};
app.toggleBuddy = async () => {
  if (app.buddy) {
    await invoke("close_buddy");
    app.buddy = false;
    app.mood("happy", 1);
    play("hello");
  } else {
    await invoke("spawn_buddy");
    app.buddy = true;
    play("jump");
    setTimeout(() => void emit("monu-style", { hue: state.settings.hue, outfit: state.settings.outfit }), 600);
  }
  render(true);
};
app.startDemo = () => {
  startDemo();
  setIsland("home");
  setTab("agents");
};
app.stopDemo = () => {
  stopDemo();
  render(true);
};
app.setAutostart = async (on: boolean) => {
  try {
    on ? await enable() : await disable();
    app.autostart = await isEnabled();
  } catch (e) {
    console.warn(e);
  }
};
app.refreshServices = () => {
  for (const id of state.settings.pills) {
    const p = PILLS.find((x) => x.id === id);
    if (p?.category === "service") void refreshService(id, p.name).then(() => ui.tab === "pills" && render());
  }
};

(document.getElementById("mo") as HTMLCanvasElement).addEventListener("click", (e) => {
  e.stopPropagation();
  if (app.island !== "home") {
    setIsland("home");
    return;
  }
  const r = monu.poke();
  play(r === "dizzy" ? "dizzy" : "annoyed");
  void emit("monu-mood", { mood: r === "dizzy" ? "dizzy" : "annoyed", sec: 1 });
});

isl.addEventListener("click", () => {
  if (app.island !== "home") setIsland("home");
});
document.getElementById("x")!.addEventListener("click", (e) => {
  e.stopPropagation();
  setIsland("peek");
  scheduleCollapse();
});

// ---------- hit-testing: tell Rust where the island is, so the rest stays click-through ----------
let lastRect = "";
function islandRect() {
  const r = isl.getBoundingClientRect();
  const w = Math.max(r.width, 200);
  return { x: r.left + r.width / 2 - w / 2, y: 0, w, h: Math.max(r.height, 14) };
}
setInterval(() => {
  const r = islandRect();
  const key = [r.x, r.y, r.w, r.h].map((n) => Math.round(n)).join(",");
  if (key !== lastRect) {
    lastRect = key;
    void invoke("set_hit_rect", { x: r.x, y: r.y, w: r.w, h: r.h });
  }
}, 40);

// cursor comes from Rust (works even while the window is click-through)
void listen<{ x: number; y: number }>("cursor", (e) => {
  const { x, y } = e.payload;
  monu.setLook(x, y);
  const r = islandRect();
  const nowInside = x >= r.x - 4 && x <= r.x + r.w + 4 && y >= -2 && y <= r.h + 4;
  if (nowInside === inside) return;
  inside = nowInside;
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  if (inside) {
    if (app.island === "hid") setIsland("peek");
    if (state.settings.openOnHover && app.island === "peek") hoverTimer = window.setTimeout(() => inside && setIsland("home"), 350);
  } else {
    scheduleCollapse();
  }
});

// ---------- agent events ----------
void listen("agent-event", (e) => handleAgentEvent(e.payload));
void listen<{ id: string }>("agent-cancel", (e) => cancelPerm(e.payload.id));
void listen("buddy-home", () => {
  app.buddy = false;
  app.mood("happy", 1.2);
  render(true);
});

onSessions((kind, data) => {
  if (kind === "perm") {
    const isQ = !!data?.questions;
    setIsland("home");
    setTab("agents");
    app.mood("alert", 3);
    play(isQ ? "question" : "approval");
  } else if (kind === "finished") {
    app.mood("happy", 1.8);
    monu.jump();
    play("finish");
    if (app.island === "hid") setIsland("peek");
    if (!inside) scheduleCollapse();
  } else if (kind === "activity") {
    if (app.island === "hid") setIsland("peek");
    if (!inside && !hasWork()) scheduleCollapse();
  } else if (kind === "change" && app.island === "hid" && (perms.length || anyWorking())) {
    setIsland("peek");
  }
  render();
});

// ---------- tray ----------
void listen<string>("tray", (e) => {
  switch (e.payload) {
    case "settings": setIsland("home"); setTab("settings"); break;
    case "chat": setIsland("home"); setTab("chat"); break;
    case "mute": toggleMute(); break;
    case "demo": state.demo ? app.stopDemo() : app.startDemo(); break;
  }
});

function toggleMute() {
  const m = !isMuted();
  app.setMute(m);
  play(m ? "mute" : "unmute"); // plays only when unmuting
  render(true);
}

// ---------- shortcuts ----------
const shortcutActions: Record<string, () => void> = {
  toggle: () => (app.island === "home" ? setIsland("peek") : setIsland("home")),
  chat: () => { setIsland("home"); setTab("chat"); setTimeout(() => (document.getElementById("chatin") as HTMLElement | null)?.focus(), 80); },
  allow: () => { const p = perms[0]; if (p && !p.questions) { play("allow"); void allow(p); } },
  deny: () => { const p = perms[0]; if (p) { play("deny"); void deny(p); } },
  mute: toggleMute,
  desktop: () => void app.toggleBuddy(),
  wardrobe: () => {
    const s = state.settings;
    s.outfit = ((s.outfit < 0 ? 0 : s.outfit) + 1) % OUTFITS.length;
    saveSettings();
    app.applyStyle();
    play("wardrobe");
    app.mood("happy", 1);
  },
};
app.bindShortcuts = async () => {
  try {
    await unregisterAll();
    for (const [name, combo] of Object.entries(state.settings.shortcuts)) {
      if (!combo || !shortcutActions[name]) continue;
      await register(combo, (ev) => {
        if (ev.state === "Pressed") shortcutActions[name]();
      }).catch((err) => console.warn("shortcut", name, combo, err));
    }
  } catch (e) {
    console.warn(e);
  }
};

// ---------- now playing ----------
async function pollMedia() {
  if (!state.settings.pills.includes("spotify")) {
    if (app.media) { app.media = null; monu.setDancing(false); void emit("monu-dance", false); }
    return;
  }
  try {
    const m = await invoke<typeof app.media>("media_info");
    const wasPlaying = !!app.media?.playing;
    app.media = m;
    const playing = !!m?.playing;
    if (playing !== wasPlaying) {
      monu.setDancing(playing);
      void emit("monu-dance", playing);
      if (playing) play("dance", 0.6);
    }
    updateMedia();
  } catch {
    /* media session unavailable */
  }
}
setInterval(pollMedia, 1500);
setInterval(() => app.refreshServices(), 120_000);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setIsland(app.island === "home" ? "peek" : "hid");
});

// ---------- boot ----------
(async function boot() {
  const s = await loadSettings();
  setMuted(s.muted);
  monu.hue = s.hue;
  monu.outfit = s.outfit < 0 ? seasonalOutfit() : s.outfit;
  monu.start();
  wireUi();
  app.monitors = await invoke<string[]>("monitors").catch(() => []);
  app.autostart = await isEnabled().catch(() => false);
  await Promise.all([loadStats(), refreshKeyStates()]);
  void loadCustomSounds();
  app.applyOptions();
  void app.bindShortcuts();
  render(true);
  app.refreshServices();
  // greeting
  setTimeout(() => {
    setIsland("peek");
    app.mood("wave", 1.6);
    play("wake");
    const st = document.getElementById("st");
    if (st) st.textContent = t("greeting");
    setTimeout(() => { if (!inside && !hasWork()) setIsland("hid"); render(true); }, 2600);
  }, 500);
  void sessions;
})();
