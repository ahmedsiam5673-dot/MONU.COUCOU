import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  lang: string;
  hue: number;
  outfit: number; // -1 = automatic (seasonal)
  muted: boolean;
  openOnHover: boolean;
  autoCollapse: boolean;
  hideFullscreen: boolean;
  followMouse: boolean;
  screen: number; // -1 = primary
  pills: string[];
  provider: string;
  models: Record<string, string>;
  ollamaUrl: string;
  lmUrl: string;
  shortcuts: Record<string, string>;
  alwaysAllow: string[];
  recapProjects: boolean;
}

export const DEFAULTS: Settings = {
  lang: "en",
  hue: 262,
  outfit: -1,
  muted: false,
  openOnHover: true,
  autoCollapse: true,
  hideFullscreen: true,
  followMouse: false,
  screen: -1,
  pills: ["claude", "anthropic", "spotify"],
  provider: "anthropic",
  models: {
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4o",
    google: "gemini-2.0-flash",
    ollama: "llama3.2",
    lmstudio: "local-model",
  },
  ollamaUrl: "http://localhost:11434",
  lmUrl: "http://localhost:1234",
  shortcuts: {
    toggle: "CommandOrControl+Alt+M",
    chat: "CommandOrControl+Alt+C",
    allow: "CommandOrControl+Alt+A",
    deny: "CommandOrControl+Alt+D",
    mute: "CommandOrControl+Alt+S",
    desktop: "CommandOrControl+Alt+B",
    wardrobe: "CommandOrControl+Alt+W",
  },
  alwaysAllow: [],
  recapProjects: true,
};

export const state = { settings: structuredClone(DEFAULTS), demo: false };

export async function loadSettings(): Promise<Settings> {
  try {
    const v = await invoke<Partial<Settings> | null>("store_get", { key: "settings" });
    if (v) {
      const s = { ...DEFAULTS, ...v };
      s.models = { ...DEFAULTS.models, ...(v.models ?? {}) };
      s.shortcuts = { ...DEFAULTS.shortcuts, ...(v.shortcuts ?? {}) };
      state.settings = s;
    }
  } catch (e) {
    console.warn("settings load failed", e);
  }
  return state.settings;
}

let saveTimer: number | undefined;
export function saveSettings() {
  if (state.demo) return; // demo mode never writes to disk
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke("store_set", { key: "settings", value: state.settings }).catch(console.warn);
  }, 300);
}

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    return (await invoke<T | null>("store_get", { key })) ?? null;
  } catch {
    return null;
  }
}
export async function setJson(key: string, value: unknown) {
  if (state.demo) return;
  try {
    await invoke("store_set", { key, value });
  } catch (e) {
    console.warn(e);
  }
}

export const secrets = {
  get: (name: string) => invoke<string | null>("secret_get", { name }).catch(() => null),
  set: (name: string, value: string) => invoke("secret_set", { name, value }),
  del: (name: string) => invoke("secret_delete", { name }),
};
