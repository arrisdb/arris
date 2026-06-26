import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Feature-sliced dependency boundaries (MIN-409). Element model:
//   shared  -> leaf primitives + DTO vocabulary + the global preferences store
//              and cross-domain contribution registries (src/shared/**)
//   shell   -> app-shell composition root + editor tab-host (src/shell/**)
//   domain  -> one element per src/domains/<domain>
//
// Rules:
//   shared  is a leaf: may import only shared (Zustand stores now live with the
//           feature that owns them; the global settings store is itself shared).
//   domains may import shared, shell, and a SIBLING domain ONLY through its
//           public barrels — the root index.ts (full surface) or the store-only
//           hooks/index.ts subbarrel — enforced by entry-point scoped to
//           src/domains/** so it constrains domain importers only (shell, the
//           composition root, keeps deep access to domain internals).
//   shell   may import anything.

const elements = [
  { type: "shared", pattern: "src/shared", mode: "folder" },
  { type: "shell", pattern: "src/shell", mode: "folder" },
  { type: "domain", pattern: "src/domains/*", mode: "folder", capture: ["domain"] },
];

const settings = {
  "boundaries/elements": elements,
  "boundaries/include": ["src/**/*.{ts,tsx}"],
  "import/resolver": {
    typescript: { project: "tsconfig.json" },
  },
};

export default [
  {
    ignores: [
      "dist/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "src/test/**",
      "**/*.config.*",
    ],
  },
  // Only the classic exhaustive-deps rule (warn) — enough to keep the existing
  // inline disable directives meaningful. The full react-hooks "recommended"
  // set now bundles React-Compiler rules; rolling those out is out of scope for
  // the MIN-409 boundary work.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/exhaustive-deps": "warn" },
  },
  // Layer rules for every source element.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
    settings,
    rules: {
      "boundaries/no-unknown": "off",
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: ["shared"], allow: ["shared"] },
            { from: ["shell"], allow: ["shell", "shared", "domain"] },
            { from: ["domain"], allow: ["shared", "shell", "domain"] },
          ],
        },
      ],
    },
  },
  // Barrel rule: a domain reaches a sibling domain only via its public barrels:
  // the root index.ts (full surface) or the store-only hooks/index.ts subbarrel.
  // The subbarrel exists so a sibling can pull just another domain's store hook
  // without dragging that domain's whole component graph into module-init (which
  // breaks partial-mock tests). Scoped to domain files so it constrains domain
  // importers, not shell.
  {
    files: ["src/domains/**/*.{ts,tsx}"],
    plugins: { boundaries },
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
    settings,
    rules: {
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          rules: [
            { target: ["shared", "shell"], allow: "**" },
            { target: ["domain"], allow: ["index.{ts,tsx}", "hooks/index.{ts,tsx}"] },
          ],
        },
      ],
    },
  },
];
