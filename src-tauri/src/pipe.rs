//! Named-pipe server: receives hook events from monu-hook.exe.
//! Protocol: one JSON line from the hook. If "wait" is true, we answer with one JSON line.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::oneshot;

pub struct Pending(pub Mutex<HashMap<String, oneshot::Sender<Value>>>);

static COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        let name = format!(r"\\.\pipe\monu-{user}");
        let mut server = match ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create(&name)
        {
            Ok(s) => s,
            Err(e) => {
                // Another Monu is already running.
                eprintln!("monu: pipe already in use ({e}), exiting");
                app.exit(0);
                return;
            }
        };
        loop {
            if server.connect().await.is_err() {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
            let connected = server;
            server = match ServerOptions::new().reject_remote_clients(true).create(&name) {
                Ok(s) => s,
                Err(_) => return,
            };
            let app2 = app.clone();
            tauri::async_runtime::spawn(handle(app2, connected));
        }
    });
}

async fn handle(app: AppHandle, pipe: NamedPipeServer) {
    let (rd, mut wr) = tokio::io::split(pipe);
    let mut br = BufReader::new(rd);
    let mut line = String::new();
    match tokio::time::timeout(Duration::from_secs(5), br.read_line(&mut line)).await {
        Ok(Ok(n)) if n > 0 => {}
        _ => return,
    }
    let mut msg: Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => return,
    };
    let id = format!("e{}", COUNTER.fetch_add(1, Ordering::Relaxed));
    msg["id"] = json!(id);
    let wait = msg["wait"].as_bool().unwrap_or(false);

    let rx = if wait {
        let (tx, rx) = oneshot::channel();
        app.state::<Pending>().0.lock().unwrap().insert(id.clone(), tx);
        Some(rx)
    } else {
        None
    };
    let _ = app.emit("agent-event", &msg);

    if let Some(rx) = rx {
        let mut junk = String::new();
        tokio::select! {
            r = tokio::time::timeout(Duration::from_secs(590), rx) => {
                if let Ok(Ok(v)) = r {
                    let mut s = v.to_string();
                    s.push('\n');
                    let _ = wr.write_all(s.as_bytes()).await;
                    let _ = wr.flush().await;
                } else {
                    app.state::<Pending>().0.lock().unwrap().remove(&id);
                    let _ = app.emit("agent-cancel", json!({ "id": id }));
                }
            }
            // The hook process went away (agent cancelled / user answered in the terminal).
            _ = br.read_line(&mut junk) => {
                app.state::<Pending>().0.lock().unwrap().remove(&id);
                let _ = app.emit("agent-cancel", json!({ "id": id }));
            }
        }
    }
}

#[tauri::command]
pub fn respond(state: tauri::State<'_, Pending>, id: String, response: Value) -> bool {
    match state.0.lock().unwrap().remove(&id) {
        Some(tx) => tx.send(response).is_ok(),
        None => false,
    }
}
