// Builds the monu-hook CLI and copies it where Tauri expects the sidecar.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const triple = "x86_64-pc-windows-msvc";
console.log("Building monu-hook…");
execSync("cargo build --release --manifest-path hook/Cargo.toml", { cwd: root, stdio: "inherit" });
const src = join(root, "hook", "target", "release", "monu-hook.exe");
const outDir = join(root, "src-tauri", "binaries");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, `monu-hook-${triple}.exe`));
console.log("monu-hook sidecar ready.");
