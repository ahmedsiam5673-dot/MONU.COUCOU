//! "Now playing" via Windows System Media Transport Controls (Spotify, Apple Music, browsers, …).
use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

#[derive(Serialize, Default)]
pub struct Media {
    title: String,
    artist: String,
    source: String,
    playing: bool,
    position: f64,
    duration: f64,
}

fn init_winrt() {
    unsafe {
        let _ = windows::Win32::System::WinRT::RoInitialize(
            windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
        );
    }
}

fn current() -> windows::core::Result<Option<Media>> {
    init_winrt();
    let mgr = Manager::RequestAsync()?.get()?;
    let s = match mgr.GetCurrentSession() {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let playing = s.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    let (mut position, mut duration) = (0.0, 0.0);
    if let Ok(tl) = s.GetTimelineProperties() {
        let secs = |d: i64| d as f64 / 10_000_000.0;
        position = tl.Position().map(|t| secs(t.Duration)).unwrap_or(0.0);
        let start = tl.StartTime().map(|t| secs(t.Duration)).unwrap_or(0.0);
        let end = tl.EndTime().map(|t| secs(t.Duration)).unwrap_or(0.0);
        duration = (end - start).max(0.0);
    }
    Ok(Some(Media {
        title: props.Title()?.to_string(),
        artist: props.Artist()?.to_string(),
        source: s.SourceAppUserModelId()?.to_string(),
        playing,
        position,
        duration,
    }))
}

#[tauri::command]
pub async fn media_info() -> Result<Option<Media>, String> {
    tauri::async_runtime::spawn_blocking(|| current().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_cmd(cmd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<()> {
        init_winrt();
        let mgr = Manager::RequestAsync()?.get()?;
        let s = mgr.GetCurrentSession()?;
        match cmd.as_str() {
            "toggle" => {
                s.TryTogglePlayPauseAsync()?.get()?;
            }
            "next" => {
                s.TrySkipNextAsync()?.get()?;
            }
            "prev" => {
                s.TrySkipPreviousAsync()?.get()?;
            }
            _ => {}
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
