//! JSON key/value store, secrets (Windows Credential Manager), custom sounds, PNG export.
use base64::Engine;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn safe(k: &str) -> bool {
    !k.is_empty() && k.len() < 64 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub fn store_get(app: AppHandle, key: String) -> Result<Value, String> {
    if !safe(&key) {
        return Err("bad key".into());
    }
    let p = dir(&app)?.join(format!("{key}.json"));
    match std::fs::read_to_string(p) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
pub fn store_set(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    if !safe(&key) {
        return Err("bad key".into());
    }
    let p = dir(&app)?.join(format!("{key}.json"));
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, p).map_err(|e| e.to_string())
}

// ---- secrets: Windows Credential Manager ----
#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    if !safe(&name) {
        return Err("bad name".into());
    }
    keyring::Entry::new("monu", &name)
        .and_then(|e| e.set_password(&value))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    if !safe(&name) {
        return Err("bad name".into());
    }
    match keyring::Entry::new("monu", &name).and_then(|e| e.get_password()) {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    if !safe(&name) {
        return Err("bad name".into());
    }
    match keyring::Entry::new("monu", &name).and_then(|e| e.delete_credential()) {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---- custom sounds: <config>/sounds/<name>.(wav|mp3|ogg) ----
#[tauri::command]
pub fn read_sound(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if !safe(&name) {
        return Ok(None);
    }
    let d = dir(&app)?.join("sounds");
    for ext in ["wav", "mp3", "ogg"] {
        let p = d.join(format!("{name}.{ext}"));
        if let Ok(b) = std::fs::read(&p) {
            return Ok(Some(base64::engine::general_purpose::STANDARD.encode(b)));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn open_sounds_folder(app: AppHandle) -> Result<(), String> {
    let d = dir(&app)?.join("sounds");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(d).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ---- weekly recap image ----
#[tauri::command]
pub fn save_png(name: String, b64: String) -> Result<String, String> {
    if !safe(&name) {
        return Err("bad name".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim_start_matches("data:image/png;base64,"))
        .map_err(|e| e.to_string())?;
    let dir = dirs::picture_dir().or_else(dirs::home_dir).ok_or("no folder")?;
    let p = dir.join(format!("{name}.png"));
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}
