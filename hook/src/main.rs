//! monu-hook: forwards an AI agent's hook event to the Monu app over a Windows named pipe.
//!
//! Usage: monu-hook --agent <name> [--wait]
//!   --agent  claude | codex | cursor | gemini | copilot | muse | opencode | amp | hermes | <anything>
//!   --wait   block until the user answers in Monu (permission requests)
//!
//! If Monu is not running, this exits 0 immediately so the agent is never blocked.
#![cfg_attr(not(debug_assertions), allow(unused))]

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetConsoleWindow() -> isize;
}

fn console_hwnd() -> i64 {
    #[cfg(windows)]
    unsafe {
        GetConsoleWindow() as i64
    }
    #[cfg(not(windows))]
    0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut agent = String::from("claude");
    let mut wait = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--agent" if i + 1 < args.len() => {
                agent = args[i + 1].clone();
                i += 1;
            }
            "--wait" => wait = true,
            _ => {}
        }
        i += 1;
    }

    let mut stdin = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin);
    let payload: Value = serde_json::from_str(&stdin).unwrap_or_else(|_| json!({ "raw": stdin }));

    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
    let pipe_path = format!(r"\\.\pipe\monu-{}", user);

    // Monu not running → exit immediately, never block the agent.
    let file = std::fs::OpenOptions::new().read(true).write(true).open(&pipe_path);
    let mut file = match file {
        Ok(f) => f,
        Err(_) => return,
    };

    let msg = json!({
        "agent": agent,
        "wait": wait,
        "hwnd": console_hwnd(),
        "payload": payload,
    });
    let mut line = msg.to_string();
    line.push('\n');
    if file.write_all(line.as_bytes()).is_err() || file.flush().is_err() {
        return;
    }
    if !wait {
        return;
    }

    // Wait for the user's decision.
    let mut reader = BufReader::new(file);
    let mut resp = String::new();
    if reader.read_line(&mut resp).is_err() {
        return;
    }
    let resp: Value = match serde_json::from_str(resp.trim()) {
        Ok(v) => v,
        Err(_) => return,
    };

    let event = payload
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("PermissionRequest");

    match resp.get("decision").and_then(|v| v.as_str()) {
        Some("allow") => {
            let mut decision = json!({ "behavior": "allow" });
            if let Some(ui) = resp.get("updated_input") {
                if !ui.is_null() {
                    decision["updatedInput"] = ui.clone();
                }
            }
            println!(
                "{}",
                json!({ "hookSpecificOutput": { "hookEventName": event, "decision": decision } })
            );
        }
        Some("deny") => {
            let m = resp
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Denied from Monu");
            println!(
                "{}",
                json!({ "hookSpecificOutput": { "hookEventName": event,
                        "decision": { "behavior": "deny", "message": m } } })
            );
        }
        // "ask" or anything else: print nothing, the agent falls back to its own prompt.
        _ => {}
    }
}
