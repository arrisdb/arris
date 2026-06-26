//! OS clipboard file-list access.
//!
//! Reading a list of file paths off the system clipboard is platform-specific
//! and not covered by the cross-platform clipboard plugins. The [`ClipboardFiles`]
//! trait is the swap point: macOS reads `NSPasteboard` file URLs today, and a
//! Windows (`CF_HDROP`) implementation can be added behind the same trait without
//! touching callers.

/// Reads file paths currently held on the OS clipboard (e.g. files copied in
/// Finder / Explorer).
pub trait ClipboardFiles {
    /// Absolute paths of clipboard files, or an empty vec when the clipboard
    /// holds no files (or the platform has no implementation yet).
    fn read_file_paths(&self) -> Vec<String>;
}

/// The real operating-system clipboard.
pub struct SystemClipboard;

impl ClipboardFiles for SystemClipboard {
    fn read_file_paths(&self) -> Vec<String> {
        read_clipboard_file_paths()
    }
}

#[cfg(target_os = "macos")]
fn read_clipboard_file_paths() -> Vec<String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSString, NSURL};

    let mut paths = Vec::new();
    let pasteboard = NSPasteboard::generalPasteboard();
    let Some(items) = pasteboard.pasteboardItems() else {
        return paths;
    };
    // `public.file-url` is the modern UTI Finder writes for copied files.
    let file_url_type = NSString::from_str("public.file-url");
    for item in items.iter() {
        let Some(url_string) = item.stringForType(&file_url_type) else {
            continue;
        };
        let Some(url) = NSURL::URLWithString(&url_string) else {
            continue;
        };
        if let Some(path) = url.path() {
            paths.push(path.to_string());
        }
    }
    paths
}

#[cfg(not(target_os = "macos"))]
fn read_clipboard_file_paths() -> Vec<String> {
    // Windows/Linux clipboard file-lists are not implemented yet; callers fall
    // back to the in-app tree clipboard.
    Vec::new()
}
