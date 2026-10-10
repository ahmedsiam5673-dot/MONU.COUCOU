export type PillCategory = "agent" | "ai" | "service" | "media";
export interface PillDef {
  id: string;
  name: string;
  color: string;
  category: PillCategory;
  secret?: string; // credential name when a key is needed
}

/** Single source of truth for every pill. */
export const PILLS: PillDef[] = [
  { id: "claude", name: "Claude Code", color: "#d97757", category: "agent" },
  { id: "codex", name: "Codex", color: "#10a37f", category: "agent" },
  { id: "cursor", name: "Cursor", color: "#8b8fa8", category: "agent" },
  { id: "gemini", name: "Gemini CLI", color: "#4285f4", category: "agent" },
  { id: "copilot", name: "Copilot CLI", color: "#8957e5", category: "agent" },
  { id: "muse", name: "Muse Code", color: "#e5588b", category: "agent" },
  { id: "opencode", name: "OpenCode", color: "#3fb68b", category: "agent" },
  { id: "amp", name: "Amp", color: "#f0883e", category: "agent" },
  { id: "hermes", name: "Hermes", color: "#d4a72c", category: "agent" },
  { id: "anthropic", name: "Anthropic", color: "#d97757", category: "ai", secret: "anthropic" },
  { id: "openai", name: "OpenAI", color: "#10a37f", category: "ai", secret: "openai" },
  { id: "google", name: "Google AI", color: "#4285f4", category: "ai", secret: "google" },
  { id: "ollama", name: "Ollama", color: "#9aa1b0", category: "ai" },
  { id: "lmstudio", name: "LM Studio", color: "#6e7bff", category: "ai" },
  { id: "github", name: "GitHub", color: "#8957e5", category: "service", secret: "github" },
  { id: "vercel", name: "Vercel", color: "#e8eaf0", category: "service", secret: "vercel" },
  { id: "stripe", name: "Stripe", color: "#635bff", category: "service", secret: "stripe" },
  { id: "spotify", name: "Now playing", color: "#1db954", category: "media" },
];

export const pillById = (id: string) => PILLS.find((p) => p.id === id);
export const agentColor = (agent: string) => pillById(agent)?.color ?? "#7c5cff";
export const agentName = (agent: string) => pillById(agent)?.name ?? agent;
