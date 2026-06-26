import { useTabsStore } from "../hooks/tabsStore";

// Third-party license bundles shipped as static assets in frontend/public.
// Generated out-of-tree by local/generate-licenses.sh.
type LicenseDoc = "rust" | "javascript";

const LICENSE_DOCS: Record<LicenseDoc, { file: string; title: string }> = {
  rust: { file: "THIRD-PARTY-LICENSES-rust.md", title: "Third-Party Licenses (Rust)" },
  javascript: { file: "THIRD-PARTY-LICENSES-frontend.md", title: "Third-Party Licenses (JavaScript)" },
};

// Fetch the bundled markdown and open (or refocus) it as a read-only,
// in-memory markdown tab. Uses openDocTab (no filePath) so the doc is never
// written to disk.
async function openLicenseTab(doc: LicenseDoc): Promise<void> {
  const { file, title } = LICENSE_DOCS[doc];
  const res = await fetch(`/${file}`);
  const text = await res.text();
  useTabsStore.getState().openDocTab({ title, text });
}

export { openLicenseTab };
export type { LicenseDoc };
