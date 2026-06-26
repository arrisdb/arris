export function pathRelativeToRoot(path: string, root: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  if (!normalizedRoot) return path;
  if (path === normalizedRoot) return path.split("/").filter(Boolean).pop() ?? path;
  const prefix = `${normalizedRoot}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
