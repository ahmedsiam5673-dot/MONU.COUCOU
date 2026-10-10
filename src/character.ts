/** Monu: an original character drawn on a canvas (squircle body, ears, sphere-projected eyes). */
export type Mood = "idle" | "happy" | "annoyed" | "dizzy" | "alert" | "wave" | "dance" | "box" | "sleepy";

export const OUTFITS = ["none", "party hat", "scarf", "sunglasses", "santa hat", "witch hat", "bow tie"];

/** Seasonal outfit used when outfit = -1 (automatic). */
export function seasonalOutfit(d = new Date()): number {
  const m = d.getMonth();
  if (m === 11) return 4; // December
  if (m === 9) return 5; // October
  return 0;
}

export class Monu {
  hue = 262;
  outfit = 0;
  private g: CanvasRenderingContext2D;
  private sq = 0; // squish spring
  private sv = 0;
  private jy = 0; // jump spring
  private jv = 0;
  private cur: Mood = "idle";
  private until = 0;
  private dancing = false;
  private blink = 0;
  private blinkAt = 2;
  private eyeScale = 1;
  private hover = false;
  private look: { x: number; y: number } | null = null;
  private clicks: number[] = [];
  private raf = 0;
  private cx = 0.5; // optional horizontal drift (desktop buddy)

  constructor(public cv: HTMLCanvasElement) {
    cv.width = 160;
    cv.height = 160;
    this.g = cv.getContext("2d")!;
    cv.addEventListener("pointerenter", () => (this.hover = true));
    cv.addEventListener("pointerleave", () => (this.hover = false));
  }

  setLook(x: number, y: number) {
    this.look = { x, y };
  }
  mood(m: Mood, sec: number) {
    this.cur = m;
    this.until = performance.now() / 1000 + sec;
  }
  get current(): Mood {
    return this.dancing && this.cur === "idle" ? "dance" : this.cur;
  }
  setDancing(on: boolean) {
    this.dancing = on;
  }
  jump() {
    this.jv = -380;
  }
  squish() {
    this.sv = 7;
  }
  /** Poke from a click. Returns what Monu felt: annoyed, or dizzy after 3 quick pokes. */
  poke(): "annoyed" | "dizzy" {
    const n = performance.now();
    this.clicks = this.clicks.filter((c) => n - c < 1000);
    this.clicks.push(n);
    this.squish();
    if (this.clicks.length >= 3) {
      this.clicks = [];
      this.mood("dizzy", 3);
      return "dizzy";
    }
    this.mood("annoyed", 0.8);
    return "annoyed";
  }

  start() {
    const loop = (t: number) => {
      this.draw(t / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }

  private draw(now: number) {
    const dt = 1 / 60;
    this.sv += (-220 * this.sq - 12 * this.sv) * dt;
    this.sq += this.sv * dt;
    this.jv += (-300 * this.jy - 14 * this.jv) * dt;
    this.jy += this.jv * dt;
    const clock = performance.now() / 1000;
    if (clock > this.until && this.cur !== "idle") this.cur = "idle";
    if (now > this.blinkAt) {
      this.blink = 1;
      this.blinkAt = now + 2 + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt * 8);
    this.eyeScale += ((this.hover ? 1.25 : 1) - this.eyeScale) * 0.15;

    const m = this.current;
    const r = this.cv.getBoundingClientRect();
    let ex = 0;
    let ey = 0;
    if (this.look) {
      const dx = this.look.x - (r.left + r.width / 2);
      const dy = this.look.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 180);
      ex = (dx / d) * k * 6;
      ey = (dy / d) * k * 5;
    }

    const g = this.g;
    g.clearRect(0, 0, 160, 160);
    g.save();
    g.translate(80, 92 + this.jy);
    const br = Math.sin(now * 2) * 0.02;
    const rot =
      m === "dance" ? Math.sin(now * 9) * 0.18 : m === "wave" ? Math.sin(now * 12) * 0.08 : m === "dizzy" ? Math.sin(now * 5) * 0.15 : 0;
    if (m === "dance") g.translate(Math.sin(now * 4.5) * 8, -Math.abs(Math.sin(now * 9)) * 8);
    g.rotate(rot);
    g.scale(1 + this.sq * 0.25 + br, 1 - this.sq * 0.25 - br);

    if (m === "box") {
      g.fillStyle = "#c8955a";
      g.beginPath();
      g.roundRect(-40, -34, 80, 68, 6);
      g.fill();
      g.fillStyle = "#e7c08a";
      g.fillRect(-6, -34, 12, 68);
      g.restore();
      return;
    }

    const col = `hsl(${this.hue} 80% 62%)`;
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(-34, -54, 16, 22, 8);
    g.roundRect(18, -54, 16, 22, 8);
    g.fill();
    g.beginPath();
    g.roundRect(-44, -38, 88, 78, 30);
    g.fill();
    g.fillStyle = `hsl(${this.hue} 85% 80%)`;
    g.beginPath();
    g.ellipse(0, 16, 26, 15, 0, 0, 7);
    g.fill();
    g.fillStyle = "#ff8fa866";
    for (const x of [-30, 30]) {
      g.beginPath();
      g.arc(x, 8, 6, 0, 7);
      g.fill();
    }

    g.strokeStyle = "#1b1230";
    g.lineWidth = 3.5;
    g.lineCap = "round";
    const outfit = this.outfit;
    for (const sx of [-18, 18]) {
      if (m === "happy" || m === "wave") {
        g.beginPath();
        g.arc(sx, -4, 8, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      } else if (m === "dizzy") {
        g.lineWidth = 2;
        g.beginPath();
        for (let a = 0; a < 12; a += 0.4) {
          const q = a * 0.7;
          g.lineTo(sx + Math.cos(a + now * 8) * q, -6 + Math.sin(a + now * 8) * q);
        }
        g.stroke();
        g.lineWidth = 3.5;
      } else {
        const big = m === "alert" ? 1.3 : 1;
        const sleepy = m === "sleepy" ? 0.35 : 1;
        const h = (m === "annoyed" ? 4 : 7) * this.eyeScale * big * sleepy * (1 - this.blink * 0.9);
        g.fillStyle = "#1b1230";
        g.beginPath();
        g.ellipse(sx + ex, -6 + ey, 7 * this.eyeScale * big, Math.max(0.8, h), 0, 0, 7);
        g.fill();
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(sx + ex + 2, -8 + ey, 2, 0, 7);
        g.fill();
        if (m === "annoyed") {
          const s = sx < 0 ? -1 : 1;
          g.beginPath();
          g.moveTo(sx + 9 * s, -22);
          g.lineTo(sx - 8 * s, -15);
          g.stroke();
        }
      }
    }
    g.beginPath();
    if (m === "happy" || m === "wave" || m === "dance") g.arc(0, 10, 9, 0.1 * Math.PI, 0.9 * Math.PI);
    else if (m === "dizzy") {
      g.moveTo(-8, 16);
      for (let i = 1; i <= 4; i++) g.lineTo(-8 + i * 4, 16 + (i % 2 ? -3 : 3));
    } else if (m === "annoyed") {
      g.moveTo(-6, 17);
      g.lineTo(6, 17);
    } else if (m === "alert") g.ellipse(0, 16, 4, 5, 0, 0, 7);
    else g.arc(0, 11, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();

    // outfits
    if (outfit === 1) {
      g.fillStyle = "#ffcf4a";
      g.beginPath();
      g.moveTo(-14, -52);
      g.lineTo(14, -52);
      g.lineTo(0, -88);
      g.fill();
      g.fillStyle = "#e5484d";
      g.beginPath();
      g.arc(0, -88, 5, 0, 7);
      g.fill();
    } else if (outfit === 2) {
      g.fillStyle = "#e5484d";
      g.beginPath();
      g.roundRect(-44, 24, 88, 13, 6);
      g.fill();
      g.beginPath();
      g.roundRect(20, 30, 14, 26, 5);
      g.fill();
    } else if (outfit === 3) {
      g.fillStyle = "#0b0b12";
      g.beginPath();
      g.roundRect(-32, -18, 26, 16, 6);
      g.roundRect(6, -18, 26, 16, 6);
      g.fill();
      g.fillRect(-8, -14, 16, 3);
    } else if (outfit === 4) {
      g.fillStyle = "#d33";
      g.beginPath();
      g.moveTo(-34, -36);
      g.lineTo(34, -36);
      g.lineTo(12, -84);
      g.closePath();
      g.fill();
      g.fillStyle = "#fff";
      g.beginPath();
      g.roundRect(-38, -42, 76, 12, 6);
      g.fill();
      g.beginPath();
      g.arc(12, -86, 7, 0, 7);
      g.fill();
    } else if (outfit === 5) {
      g.fillStyle = "#2b1a4a";
      g.beginPath();
      g.ellipse(0, -40, 46, 9, 0, 0, 7);
      g.fill();
      g.beginPath();
      g.moveTo(-24, -42);
      g.lineTo(24, -42);
      g.lineTo(6, -92);
      g.closePath();
      g.fill();
      g.fillStyle = "#f0883e";
      g.fillRect(-23, -52, 46, 7);
    } else if (outfit === 6) {
      g.fillStyle = "#e5484d";
      g.beginPath();
      g.moveTo(0, 32);
      g.lineTo(-16, 22);
      g.lineTo(-16, 42);
      g.closePath();
      g.moveTo(0, 32);
      g.lineTo(16, 22);
      g.lineTo(16, 42);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
}
