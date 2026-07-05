// Lets the disk-reconcile tell its own autosave echo from a real external edit,
// so the watcher firing on our own write doesn't clobber the live buffer.
const lastSelfWrite = new Map<string, string>();

function recordSelfWrite(path: string, content: string): void {
  lastSelfWrite.set(path, content);
}

// True when the on-disk change is our own last write, not an external edit.
function isSelfWrite(path: string, diskText: string): boolean {
  return lastSelfWrite.get(path) === diskText;
}

function clearSelfWrites(): void {
  lastSelfWrite.clear();
}

export {
  clearSelfWrites,
  isSelfWrite,
  recordSelfWrite,
};
