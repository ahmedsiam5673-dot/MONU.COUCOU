import { handleAgentEvent, removeDemoSessions } from "./sessions";
import { state } from "./store";
import { serviceData } from "./services";

let timers: number[] = [];

const cwdA = "C:/Users/you/projects/storefront";
const cwdB = "C:/Users/you/projects/api-server";
let n = 0;

function send(ms: number, agent: string, payload: Record<string, unknown>, wait = false) {
  timers.push(
    window.setTimeout(() => handleAgentEvent({ id: `demo-${++n}`, agent, wait, demo: true, hwnd: 0, payload }), ms),
  );
}

export function startDemo() {
  stopDemo(true);
  state.demo = true;
  const c = { session_id: "demo-claude", cwd: cwdA };
  const x = { session_id: "demo-codex", cwd: cwdB };
  send(0, "claude", { ...c, hook_event_name: "SessionStart" });
  send(300, "claude", { ...c, hook_event_name: "UserPromptSubmit", prompt: "Add a dark mode toggle to the header" });
  send(1500, "claude", { ...c, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: `${cwdA}/src/Header.tsx` } });
  send(2600, "codex", { ...x, hook_event_name: "UserPromptSubmit", prompt: "Fix the flaky payment tests" });
  send(3200, "codex", { ...x, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test -- payments" } });
  send(4000, "claude", {
    ...c,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: {
      file_path: `${cwdA}/src/Header.tsx`,
      old_string: "export function Header() {\n  return <header className=\"bar\">Shop</header>;\n}",
      new_string: "export function Header() {\n  const [dark, setDark] = useState(false);\n  return (\n    <header className={dark ? \"bar dark\" : \"bar\"}>\n      Shop <button onClick={() => setDark(!dark)}>Theme</button>\n    </header>\n  );\n}",
    },
  });
  send(6000, "claude", { ...c, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm run build" } }, true);
  send(10000, "codex", {
    ...x,
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [
        { question: "Which test runner should I use?", header: "Runner", multiSelect: false, options: [{ label: "Vitest", description: "Fast, Vite-native" }, { label: "Jest", description: "Already in package.json" }] },
      ],
    },
  }, true);
  send(14000, "codex", { ...x, hook_event_name: "Stop" });
  send(16000, "claude", { ...c, hook_event_name: "Stop" });

  serviceData.set("github", { title: "GitHub", at: Date.now(), rows: [{ label: "Open PRs: 3  ·  Reviews requested: 1", tone: "warn" }, { label: "Add dark mode toggle", detail: "you/storefront" }, { label: "Review: Refactor checkout", detail: "team/api-server", tone: "warn" }] });
  serviceData.set("vercel", { title: "Vercel", at: Date.now(), rows: [{ label: "storefront", detail: "READY · just now", tone: "good" }, { label: "api-server", detail: "BUILDING · 2 min ago", tone: "warn" }] });
  serviceData.set("stripe", { title: "Stripe", at: Date.now(), rows: [{ label: "Available: 1,284.50 EUR", tone: "good" }, { label: "49.00 EUR", detail: "succeeded · today", tone: "good" }] });
}

export function stopDemo(silent = false) {
  timers.forEach(clearTimeout);
  timers = [];
  if (state.demo) {
    state.demo = false;
    removeDemoSessions();
    for (const id of ["github", "vercel", "stripe"]) serviceData.delete(id);
  }
  void silent;
}

export async function* fakeReply(): AsyncGenerator<string> {
  const text = "This is demo mode, so I'm not calling a real model. Add an API key under Pills → AI and I'll answer for real.";
  for (const w of text.split(" ")) {
    await new Promise((r) => setTimeout(r, 45));
    yield w + " ";
  }
}
