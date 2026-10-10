//! Installs Monu's hooks into ~/.claude/settings.json (with backup and a diff preview).
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;

/// (event, needs_matcher, wait_for_user)
const EVENTS: &[(&str, bool, bool)] = &[
    ("PermissionRequest", true, true),
    ("PreToolUse", true, false),
    ("PostToolUse", true, false),
    ("UserPromptSubmit", false, false),
    ("Notification", false, false),
    ("Stop", false, false),
    ("SessionStart", false, false),
    ("SessionEnd", false, false),
];

#[derive(Serialize)]
pub struct Plan {
    path: String,
    before: String,
    after: String,
    installed: bool,
}

fn settings_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .ok_or_else(|| "cannot find home folder".to_string())
}

fn hook_exe() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let p = exe.parent().ok_or("no parent")?.join("monu-hook.exe");
    // Claude Code runs hooks through a POSIX-ish shell on Windows: use forward slashes.
    Ok(p.to_string_lossy().replace('\\', "/"))
}

fn is_ours(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|a| {
            a.iter().any(|h| {
                h.get("command")
                    .and_then(|c| c.as_str())
                    .map(|c| c.contains("monu-hook"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn read_current() -> Result<(PathBuf, String, Value), String> {
    let p = settings_path()?;
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    let v = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text).map_err(|e| format!("settings.json is not valid JSON: {e}"))?
    };
    Ok((p, text, v))
}

fn merged(mut root: Value, exe: &str, remove_only: bool) -> Result<Value, String> {
    let obj = root.as_object_mut().ok_or("settings.json root is not an object")?;
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" is not an object")?;
    for (event, matcher, wait) in EVENTS {
        let arr = hooks.entry(event.to_string()).or_insert_with(|| json!([]));
        let arr = arr.as_array_mut().ok_or("hook event is not an array")?;
        arr.retain(|e| !is_ours(e));
        if !remove_only {
            let cmd = format!("\"{exe}\" --agent claude{}", if *wait { " --wait" } else { "" });
            let mut entry = json!({ "hooks": [ { "type": "command", "command": cmd,
                                                 "timeout": if *wait { 600 } else { 10 } } ] });
            if *matcher {
                entry["matcher"] = json!("*");
            }
            arr.push(entry);
        }
    }
    hooks.retain(|_, v| v.as_array().map(|a| !a.is_empty()).unwrap_or(true));
    if hooks.is_empty() {
        obj.remove("hooks");
    }
    Ok(root)
}

fn check_agent(agent: &str) -> Result<(), String> {
    if agent == "claude" {
        Ok(())
    } else {
        Err(format!(
            "Automatic install is only available for Claude Code. For '{agent}', point its hook command at: monu-hook.exe --agent {agent} (add --wait for permission requests). See README."
        ))
    }
}

#[tauri::command]
pub fn hooks_plan(agent: String, remove: bool) -> Result<Plan, String> {
    check_agent(&agent)?;
    let (path, before, root) = read_current()?;
    let installed = before.contains("monu-hook");
    let after = merged(root, &hook_exe()?, remove)?;
    Ok(Plan {
        path: path.to_string_lossy().into_owned(),
        before,
        after: serde_json::to_string_pretty(&after).map_err(|e| e.to_string())?,
        installed,
    })
}

#[tauri::command]
pub fn hooks_apply(agent: String, remove: bool) -> Result<String, String> {
    check_agent(&agent)?;
    let (path, before, root) = read_current()?;
    let after = merged(root, &hook_exe()?, remove)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if !before.is_empty() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let bak = path.with_file_name(format!("settings.json.monu-backup-{ts}"));
        std::fs::write(&bak, &before).map_err(|e| format!("backup failed: {e}"))?;
    }
    let tmp = path.with_extension("json.monu-tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&after).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
