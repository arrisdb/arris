// Idle time after the last keystroke before the buffer autosaves to disk.
const AUTOSAVE_DEBOUNCE_MS = 500;
// Extra pause after an autosave before redrawing the git gutter hunks, so
// the change bands do not jump around during brief pauses while typing.
const GIT_GUTTER_REFRESH_PAUSE_MS = 200;

export { AUTOSAVE_DEBOUNCE_MS, GIT_GUTTER_REFRESH_PAUSE_MS };
