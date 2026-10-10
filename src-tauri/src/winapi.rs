//! Tiny Win32 helpers (raw FFI, no extra crates to keep versions in sync with Tauri).
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[link(name = "user32")]
extern "system" {
    fn GetWindowLongPtrW(h: isize, i: i32) -> isize;
    fn SetWindowLongPtrW(h: isize, i: i32, v: isize) -> isize;
    fn GetForegroundWindow() -> isize;
    fn GetWindowRect(h: isize, r: *mut RECT) -> i32;
    fn GetClassNameW(h: isize, buf: *mut u16, n: i32) -> i32;
    fn SetForegroundWindow(h: isize) -> i32;
    fn ShowWindow(h: isize, cmd: i32) -> i32;
    fn IsWindow(h: isize) -> i32;
    fn IsIconic(h: isize) -> i32;
}

const GWL_EXSTYLE: i32 = -20;
const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
const WS_EX_NOACTIVATE: isize = 0x0800_0000;
const SW_RESTORE: i32 = 9;

pub fn hwnd_of<W: HasWindowHandle>(w: &W) -> Option<isize> {
    match w.window_handle().ok()?.as_raw() {
        RawWindowHandle::Win32(h) => Some(h.hwnd.get()),
        _ => None,
    }
}

/// Never take focus, never show in Alt-Tab / taskbar.
pub fn make_noactivate<W: HasWindowHandle>(w: &W) {
    if let Some(h) = hwnd_of(w) {
        unsafe {
            let cur = GetWindowLongPtrW(h, GWL_EXSTYLE);
            SetWindowLongPtrW(h, GWL_EXSTYLE, cur | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
        }
    }
}

/// True if the foreground window covers the whole monitor (game, video, presentation).
pub fn foreground_is_fullscreen(mon: (i32, i32, i32, i32), own: &[isize]) -> bool {
    unsafe {
        let h = GetForegroundWindow();
        if h == 0 || own.contains(&h) {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(h, &mut r) == 0 {
            return false;
        }
        let mut buf = [0u16; 64];
        let n = GetClassNameW(h, buf.as_mut_ptr(), 64).max(0) as usize;
        let cls = String::from_utf16_lossy(&buf[..n]);
        if matches!(cls.as_str(), "WorkerW" | "Progman" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        r.left <= mon.0 && r.top <= mon.1 && r.right >= mon.2 && r.bottom >= mon.3
    }
}

/// Bring a window (e.g. the agent's terminal) to the front.
pub fn focus(h: isize) -> bool {
    unsafe {
        if h == 0 || IsWindow(h) == 0 {
            return false;
        }
        if IsIconic(h) != 0 {
            ShowWindow(h, SW_RESTORE);
        }
        SetForegroundWindow(h) != 0
    }
}
