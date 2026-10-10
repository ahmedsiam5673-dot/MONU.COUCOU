import type { Monu, Mood } from "./character";

export type Island = "hid" | "peek" | "home";

/** Late-bound hooks so ui.ts and main.ts don't import each other. */
export const app = {
  monu: null as Monu | null,
  island: "hid" as Island,
  buddy: false,
  autostart: false,
  monitors: [] as string[],
  media: null as null | { title: string; artist: string; source: string; playing: boolean; position: number; duration: number },
  setIsland: (_s: Island) => {},
  mood: (_m: Mood, _sec: number) => {},
  applyStyle: () => {},
  applyOptions: () => {},
  bindShortcuts: () => {},
  toggleBuddy: () => {},
  startDemo: () => {},
  stopDemo: () => {},
  setAutostart: async (_on: boolean) => {},
  refreshServices: () => {},
  setMute: (_m: boolean) => {},
};
