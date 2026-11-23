/// File paths on the OS clipboard, e.g. files copied in Finder.
pub struct SystemClipboard;

impl SystemClipboard {
    /// Absolute paths of clipboard files; empty when it holds none or the OS has no reader yet.
    #[cfg(target_os = "macos")]
    pub fn file_paths() -> Vec<String> {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::{NSString, NSURL};

        use super::constants::PASTEBOARD_FILE_URL_TYPE;

        let pasteboard = NSPasteboard::generalPasteboard();
        let Some(items) = pasteboard.pasteboardItems() else {
            return Vec::new();
        };
        let file_url_type = NSString::from_str(PASTEBOARD_FILE_URL_TYPE);
        items
            .iter()
            .filter_map(|item| item.stringForType(&file_url_type))
            .filter_map(|url| NSURL::URLWithString(&url))
            .filter_map(|url| url.path())
            .map(|path| path.to_string())
            .collect()
    }

    /// Windows and Linux clipboard file lists are not read yet; the in-app tree clipboard still works.
    #[cfg(not(target_os = "macos"))]
    pub fn file_paths() -> Vec<String> {
        Vec::new()
    }
}
