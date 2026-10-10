import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Monu, Mood, seasonalOutfit } from "./character";
import { loadSettings, state } from "./store";
import { loadCustomSounds, play, setMuted } from "./sounds";

/** The desktop companion: a small floating Monu that follows the cursor. */
async function boot() {
  const s = await loadSettings();
  setMuted(s.muted);
  void loadCustomSounds();
  const monu = new Monu(document.getElementById("mo") as HTMLCanvasElement);
  monu.hue = s.hue;
  monu.outfit = s.outfit < 0 ? seasonalOutfit() : s.outfit;
  monu.start();
  monu.mood("wave", 1.5);
  play("hello");

  await listen<{ x: number; y: number }>("cursor", (e) => monu.setLook(e.payload.x, e.payload.y));
  await listen<{ mood: Mood; sec: number }>("monu-mood", (e) => monu.mood(e.payload.mood, e.payload.sec));
  await listen<{ hue: number; outfit: number }>("monu-style", (e) => {
    monu.hue = e.payload.hue;
    monu.outfit = e.payload.outfit < 0 ? seasonalOutfit() : e.payload.outfit;
  });
  await listen<boolean>("monu-dance", (e) => monu.setDancing(e.payload));

  const cv = monu.cv;
  cv.addEventListener("click", () => {
    play(monu.poke() === "dizzy" ? "dizzy" : "annoyed");
  });
  // double-click: Monu flies home
  cv.addEventListener("dblclick", async () => {
    play("bye");
    await emit("buddy-home");
    await invoke("close_buddy");
  });
  void state;
}
void boot();
