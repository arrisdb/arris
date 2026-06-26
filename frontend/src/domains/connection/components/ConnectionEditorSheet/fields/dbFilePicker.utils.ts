// Split a full file path into its directory and file-name parts. A path with a
// trailing separator (a bare folder) yields an empty name.
function splitFilePath(full: string): { dir: string; name: string } {
  const lastSep = Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\"));
  if (lastSep < 0) return { dir: "", name: full };
  return { dir: full.slice(0, lastSep), name: full.slice(lastSep + 1) };
}

// Join a directory and file name with the directory's own separator (so Windows
// paths keep `\`). An empty directory returns the name unchanged.
function joinFilePath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") ? "\\" : "/";
  const base = dir.endsWith(sep) ? dir : `${dir}${sep}`;
  return `${base}${name}`;
}

export { splitFilePath, joinFilePath };
