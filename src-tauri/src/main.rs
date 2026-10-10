#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hooks;
mod media;
mod pipe;
mod store;
mod winapi;

use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

/// Island hit rectangle in logical px relative to the main window: [x, y, w, h].
struct Hit(Mutex<[f64; 4]>);

struct Flags {
    hide_fullscreen: AtomicBool,
    follow_mouse: AtomicBool,
    screen: AtomicI32, // -1 = primary
    replace: AtomicBool,
}

#[tauri::command]
fn set_hit_rect(hit: State<'_, Hit>, x: f64, y: f64, w: f64, h: f64) {
    *hit.0.lock().unwrap() = [x, y, w, h];
}

#[tauri::command]
fn set_options(app: AppHandle, flags: State<'_, Flags>, hide_fullscreen: bool, follow_mouse: bool, screen: i32) {
    flags.hide_fullscreen.store(hide_fullscreen, Ordering::Relaxed);
    flags.follow_mouse.store(follow_mouse, Ordering::Relaxed);
    flags.screen.store(screen, Ordering::Relaxed);
    flags.replace.store(true, Ordering::Relaxed);
    let _ = app; // placement is applied by the poll thread
}

#[tauri::command]
fn focus_hwnd(h: i64) -> bool {
    winapi::focus(h as isize)
}

#[tauri::command]
fn monitors(app: AppHandle) -> Vec<String> {
    app.get_webview_window("main")
        .and_then(|w| w.available_monitors().ok())
        .map(|m| {
            m.iter()
                .enumerate()
                .map(|(i, mon)| format!("{} ({}×{})", mon.name().cloned().unwrap_or(format!("Screen {}", i + 1)), mon.size().width, mon.size().height))
                .collect()
        })
        .unwrap_or_default()
}

// async: building a window from a sync command deadlocks on Windows
#[tauri::command]
async fn spawn_buddy(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("buddy").is_some() {
        return Ok(());
    }
    let w = tauri::WebviewWindowBuilder::new(&app, "buddy", tauri::WebviewUrl::App("buddy.html".into()))
        .title("Monu")
        .inner_size(130.0, 130.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    winapi::make_noactivate(&w);
    Ok(())
}

#[tauri::command]
fn close_buddy(app: AppHandle) {
    if let Some(w) = app.get_webview_window("buddy") {
        let _ = w.close();
    }
}

fn pick_monitor(win: &WebviewWindow, screen: i32) -> Option<tauri::Monitor> {
    let mons = win.available_monitors().ok()?;
    if screen >= 0 {
        if let Some(m) = mons.get(screen as usize) {
            return Some(m.clone());
        }
    }
    win.primary_monitor().ok().flatten().or_else(|| mons.into_iter().next())
}

fn place(win: &WebviewWindow, mon: &tauri::Monitor) {
    if let Ok(sz) = win.outer_size() {
        let p = mon.position();
        let x = p.x + (mon.size().width as i32 - sz.width as i32) / 2;
        let _ = win.set_position(PhysicalPosition::new(x, p.y));
    }
}

fn poll_loop(app: AppHandle) {
    let mut ignoring = true;
    let mut last_cursor = (f64::NAN, f64::NAN);
    let mut buddy: Option<(f64, f64)> = None;
    let mut fs_hidden = false;
    let mut tick: u32 = 0;
    let mut placed_on: Option<(i32, i32)> = None;

    loop {
        std::thread::sleep(Duration::from_millis(25));
        tick = tick.wrapping_add(1);
        let Some(main) = app.get_webview_window("main") else { continue };
        let Ok(cur) = app.cursor_position() else { continue };
        let flags = app.state::<Flags>();

        // --- placement: chosen screen, or follow the mouse ---
        if flags.replace.swap(false, Ordering::Relaxed) || (tick % 10 == 0 && flags.follow_mouse.load(Ordering::Relaxed)) {
            let target = if flags.follow_mouse.load(Ordering::Relaxed) {
                main.available_monitors().ok().and_then(|ms| {
                    ms.into_iter().find(|m| {
                        let p = m.position();
                        let s = m.size();
                        cur.x >= p.x as f64 && cur.x < (p.x + s.width as i32) as f64 && cur.y >= p.y as f64 && cur.y < (p.y + s.height as i32) as f64
                    })
                })
            } else {
                pick_monitor(&main, flags.screen.load(Ordering::Relaxed))
            };
            if let Some(m) = target {
                let key = (m.position().x, m.position().y);
                if placed_on != Some(key) {
                    place(&main, &m);
                    placed_on = Some(key);
                }
            }
        }

        // --- hide while a fullscreen app is in front ---
        if tick % 10 == 0 && flags.hide_fullscreen.load(Ordering::Relaxed) {
            if let Ok(Some(m)) = main.current_monitor() {
                let p = m.position();
                let s = m.size();
                let mut own = vec![];
                if let Some(h) = winapi::hwnd_of(&main) {
                    own.push(h);
                }
                if let Some(b) = app.get_webview_window("buddy") {
                    if let Some(h) = winapi::hwnd_of(&b) {
                        own.push(h);
                    }
                }
                let fs = winapi::foreground_is_fullscreen((p.x, p.y, p.x + s.width as i32, p.y + s.height as i32), &own);
                if fs != fs_hidden {
                    fs_hidden = fs;
                    if fs {
                        let _ = main.hide();
                        if let Some(b) = app.get_webview_window("buddy") {
                            let _ = b.hide();
                        }
                    } else {
                        let _ = main.show();
                        if let Some(b) = app.get_webview_window("buddy") {
                            let _ = b.show();
                        }
                    }
                }
            }
        } else if tick % 10 == 0 && fs_hidden {
            fs_hidden = false;
            let _ = main.show();
        }

        // --- click-through except over the island ---
        let Ok(op) = main.outer_position() else { continue };
        let scale = main.scale_factor().unwrap_or(1.0);
        let rx = (cur.x - op.x as f64) / scale;
        let ry = (cur.y - op.y as f64) / scale;
        let r = *app.state::<Hit>().0.lock().unwrap();
        let inside = rx >= r[0] - 4.0 && rx <= r[0] + r[2] + 4.0 && ry >= r[1] - 2.0 && ry <= r[1] + r[3] + 4.0;
        let want_ignore = !inside;
        if want_ignore != ignoring {
            ignoring = want_ignore;
            let _ = main.set_ignore_cursor_events(ignoring);
        }
        if (rx - last_cursor.0).abs() > 0.5 || (ry - last_cursor.1).abs() > 0.5 || last_cursor.0.is_nan() {
            last_cursor = (rx, ry);
            let _ = app.emit_to("main", "cursor", json!({ "x": rx, "y": ry }));
        }

        // --- desktop buddy follows the cursor ---
        if let Some(b) = app.get_webview_window("buddy") {
            let bs = b.scale_factor().unwrap_or(1.0);
            let target = (cur.x + 40.0 * bs, cur.y + 30.0 * bs);
            let pos = buddy.get_or_insert_with(|| {
                b.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or(target)
            });
            pos.0 += (target.0 - pos.0) * 0.10;
            pos.1 += (target.1 - pos.1) * 0.10;
            let _ = b.set_position(PhysicalPosition::new(pos.0 as i32, pos.1 as i32));
            let _ = app.emit_to(
                "buddy",
                "cursor",
                json!({ "x": (cur.x - pos.0) / bs, "y": (cur.y - pos.1) / bs }),
            );
        } else {
            buddy = None;
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_http::init())
        .manage(pipe::Pending(Mutex::new(HashMap::new())))
        .manage(Hit(Mutex::new([200.0, 0.0, 160.0, 14.0])))
        .manage(Flags {
            hide_fullscreen: AtomicBool::new(true),
            follow_mouse: AtomicBool::new(false),
            screen: AtomicI32::new(-1),
            replace: AtomicBool::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            set_options,
            focus_hwnd,
            monitors,
            spawn_buddy,
            close_buddy,
            pipe::respond,
            store::store_get,
            store::store_set,
            store::secret_set,
            store::secret_get,
            store::secret_delete,
            store::read_sound,
            store::open_sounds_folder,
            store::save_png,
            hooks::hooks_plan,
            hooks::hooks_apply,
            media::media_info,
            media::media_cmd,
        ])
        .setup(|app| {
            let main = app.get_webview_window("main").expect("main window");
            winapi::make_noactivate(&main);
            if let Some(m) = pick_monitor(&main, -1) {
                place(&main, &m);
            }
            let _ = main.set_ignore_cursor_events(true);
            let _ = main.show();

            // Tray
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let chat = MenuItem::with_id(app, "chat", "Open chat", true, None::<&str>)?;
            let mute = MenuItem::with_id(app, "mute", "Mute / unmute", true, None::<&str>)?;
            let demo = MenuItem::with_id(app, "demo", "Demo mode", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Monu", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &chat, &mute, &demo, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("icon").clone())
                .tooltip("Monu")
                .menu(&menu)
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "quit" => app.exit(0),
                    id => {
                        let _ = app.emit("tray", id);
                    }
                })
                .build(app)?;

            pipe::start(app.handle().clone());
            let h = app.handle().clone();
            std::thread::spawn(move || poll_loop(h));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monu");
}
