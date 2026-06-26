# Arris release Makefile.
#
# Splits the macOS release flow into independently-runnable targets:
#   make build            compile + bundle locally (sign, notarize, staple, verify). No upload.
#   make build VERSION=x  bump version first, then build.
#   make publish          upload the already-built artifacts to a GitHub Release.
#   make release          build then publish, end to end.
#   make bump VERSION=x   bump version in tauri.conf.json + Cargo.toml only.
#   make verify           re-run the Gatekeeper check on the built .dmgs.
#   make docs-deploy      build docs/ and direct-upload dist/ to Cloudflare Pages.
#   make clean            remove the build bundle directories.
#
# Production ships one build per Mac architecture (no universal binary): Apple
# Silicon (aarch64-apple-darwin) and Intel (x86_64-apple-darwin). Every target
# that touches artifacts loops over both.
#
# Apple signing secrets are read from a gitignored .env (see RELEASE.md). Required:
#   build/release:  APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
#                   TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#   publish/release: no env vars - uses the GitHub CLI (`gh`), so run `gh auth login` once.
#   docs-deploy:     Cloudflare auth - either set CLOUDFLARE_API_TOKEN (+ optional
#                    CLOUDFLARE_ACCOUNT_ID) in .env, or run `npx wrangler login` once.
#
# Each recipe runs as a single `\`-continued shell line so it works on the
# system make (GNU Make 3.81, no .ONESHELL) as well as newer versions.

SHELL := bash
.DEFAULT_GOAL := help

PRODUCT       := Arris
GH_REPO       := arrisdb/arris
# One build per Mac architecture. arch_label (in PRELUDE) maps each triple to the
# short label used in asset names: aarch64-apple-darwin -> aarch64, x86_64-apple-darwin -> x64.
TARGETS       := aarch64-apple-darwin x86_64-apple-darwin
REPO_ROOT     := $(shell git rev-parse --show-toplevel)
CONF          := $(REPO_ROOT)/src-tauri/tauri.conf.json
CARGO_TOML    := $(REPO_ROOT)/src-tauri/Cargo.toml
# The workspace manifest carries workspace.package.version, which arris-engines
# inherits via `version.workspace = true`; the frontend has its own package.json.
# Both must be bumped in lockstep with the tauri manifests or they freeze.
WS_CARGO_TOML := $(REPO_ROOT)/Cargo.toml
FRONTEND_PKG  := $(REPO_ROOT)/frontend/package.json
DOCS_PKG      := $(REPO_ROOT)/docs/package.json
DOCS_DIR      := $(REPO_ROOT)/docs
# Cloudflare Pages project that serves the docs (direct-upload deploys). Override
# on the CLI: `make docs-deploy CF_PAGES_PROJECT=my-project`.
CF_PAGES_PROJECT ?= arris-docs

# Optional version bump arg: `make build VERSION=0.2.0`.
VERSION ?=

# Shared shell prelude, prepended (single line) to every recipe that needs it:
# enables strict mode, loads .env, and defines die / require_env / require_cmd /
# bundle_dir / arch_label helpers in the recipe's one shell. bundle_dir takes a
# target triple and returns its bundle output directory.
PRELUDE := set -euo pipefail; if [ -f "$(REPO_ROOT)/.env" ]; then set -a; . "$(REPO_ROOT)/.env"; set +a; fi; die() { echo "error: $$*" >&2; exit 1; }; require_env() { for v in "$$@"; do [ -n "$${!v:-}" ] || die "required env var '$$v' is not set (see RELEASE.md)"; done; }; require_cmd() { for c in "$$@"; do command -v "$$c" >/dev/null 2>&1 || die "required command '$$c' not found"; done; }; bundle_dir() { local td; td="$$(cd "$(REPO_ROOT)/src-tauri" && cargo metadata --format-version 1 --no-deps | jq -r .target_directory)"; echo "$$td/$$1/release/bundle"; }; arch_label() { case "$$1" in aarch64-*) echo aarch64 ;; x86_64-*) echo x64 ;; *) echo "$$1" ;; esac; }

.PHONY: help deny build build-unsigned publish release bump verify docs-deploy clean

help:
	@echo "Arris release targets:"
	@echo "  make deny                Run the cargo-deny supply-chain audit (advisories, licenses, bans, sources)."
	@echo "  make build-unsigned      Fast host-arch .dmg/.app for local testing. No signing, no env vars."
	@echo "  make build [VERSION=x]   Build, sign, notarize, staple + verify per-arch .dmgs (Apple Silicon + Intel)."
	@echo "  make publish             Upload the built artifacts + updater feed to a GitHub Release."
	@echo "  make release [VERSION=x] Build then publish, end to end."
	@echo "  make bump VERSION=x      Bump version in tauri.conf.json, both Cargo.tomls, frontend + docs package.json."
	@echo "  make verify              Re-run the Gatekeeper check on the built .dmgs."
	@echo "  make docs-deploy         Build docs/ and direct-upload dist/ to Cloudflare Pages."
	@echo "  make clean               Remove the build bundle directories."

# --- deny (supply-chain audit; gates the build) -----------------------------
deny:
	@$(PRELUDE); \
	require_cmd cargo cargo-deny; \
	echo "==> Running cargo-deny supply-chain audit"; \
	( cd "$(REPO_ROOT)" && cargo deny check )

# --- bump -------------------------------------------------------------------
bump:
	@$(PRELUDE); \
	require_cmd jq; \
	[ -n "$(VERSION)" ] || die "VERSION is required, e.g. make bump VERSION=0.2.0"; \
	echo "==> Bumping version to $(VERSION)"; \
	tmp="$$(mktemp)"; jq --arg v "$(VERSION)" '.version = $$v' "$(CONF)" > "$$tmp" && mv "$$tmp" "$(CONF)"; \
	sed -i '' -E "1,/^version = /s/^version = \".*\"/version = \"$(VERSION)\"/" "$(CARGO_TOML)"; \
	sed -i '' -E "1,/^version = /s/^version = \".*\"/version = \"$(VERSION)\"/" "$(WS_CARGO_TOML)"; \
	tmp="$$(mktemp)"; jq --arg v "$(VERSION)" '.version = $$v' "$(FRONTEND_PKG)" > "$$tmp" && mv "$$tmp" "$(FRONTEND_PKG)"; \
	tmp="$$(mktemp)"; jq --arg v "$(VERSION)" '.version = $$v' "$(DOCS_PKG)" > "$$tmp" && mv "$$tmp" "$(DOCS_PKG)"

# --- build-unsigned (fast local test build: no signing, notarization, or env) ---
build-unsigned: deny
	@$(PRELUDE); \
	require_cmd jq cargo npx npm; \
	ver="$$(jq -r .version "$(CONF)")"; \
	echo "==> Building UNSIGNED $(PRODUCT) v$$ver for local testing (host arch, no notarization)"; \
	( cd "$(REPO_ROOT)/src-tauri" && npx --yes @tauri-apps/cli build --bundles app dmg --config '{"bundle":{"createUpdaterArtifacts":false}}' ); \
	bd="$$(cd "$(REPO_ROOT)/src-tauri" && cargo metadata --format-version 1 --no-deps | jq -r .target_directory)/release/bundle"; \
	dmg="$$(ls "$$bd"/dmg/*.dmg 2>/dev/null | head -n1 || true)"; \
	app="$$(ls -d "$$bd"/macos/*.app 2>/dev/null | head -n1 || true)"; \
	echo "Built unsigned $(PRODUCT) - not notarized, so Gatekeeper warns on first open."; \
	echo "Open via right-click > Open, or clear quarantine: xattr -dr com.apple.quarantine <app>"; \
	[ -n "$$dmg" ] && echo "  DMG: $$dmg" || true; \
	[ -n "$$app" ] && echo "  App: $$app" || true

# --- build (compile, sign, notarize, staple, verify - once per arch) --------
build: deny
	@$(PRELUDE); \
	[ "$$(uname -s)" = "Darwin" ] || die "macOS build must run on macOS"; \
	require_cmd jq cargo npx spctl rustup xcrun; \
	require_env APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD; \
	if [ -n "$(VERSION)" ]; then $(MAKE) bump VERSION=$(VERSION); fi; \
	ver="$$(jq -r .version "$(CONF)")"; \
	rustup target add $(TARGETS) >/dev/null; \
	for triple in $(TARGETS); do \
		label="$$(arch_label "$$triple")"; \
		echo "==> Building $(PRODUCT) v$$ver for $$triple (signs, notarizes, staples the .dmg)"; \
		( cd "$(REPO_ROOT)/src-tauri" && npx --yes @tauri-apps/cli build --target "$$triple" --verbose ); \
		bd="$$(bundle_dir "$$triple")"; \
		dmg="$$(ls "$$bd"/dmg/*.dmg 2>/dev/null | head -n1 || true)"; \
		tarball="$$(ls "$$bd"/macos/*.app.tar.gz 2>/dev/null | head -n1 || true)"; \
		sig="$$(ls "$$bd"/macos/*.app.tar.gz.sig 2>/dev/null | head -n1 || true)"; \
		[ -f "$$dmg" ] || die "no .dmg produced under $$bd/dmg for $$triple"; \
		[ -f "$$tarball" ] || die "no updater tarball produced for $$triple"; \
		[ -f "$$sig" ] || die "no updater signature produced for $$triple (check TAURI_SIGNING_* env)"; \
		echo "==> Notarizing + stapling the $$label .dmg (tauri notarizes the .app; this covers the .dmg too)"; \
		xcrun notarytool submit "$$dmg" --apple-id "$$APPLE_ID" --password "$$APPLE_PASSWORD" --team-id "$$APPLE_TEAM_ID" --wait; \
		xcrun stapler staple "$$dmg"; \
		echo "==> Verifying Gatekeeper acceptance ($$label)"; \
		spctl -a -vvv --type install "$$dmg" 2>&1 | grep -q "source=Notarized Developer ID" || die "$$label dmg is not notarized/accepted by Gatekeeper"; \
		echo "Built $(PRODUCT) v$$ver ($$label)"; \
		echo "  DMG:     $$dmg"; \
		echo "  Updater: $$tarball"; \
	done

# --- verify (re-check existing builds) --------------------------------------
verify:
	@$(PRELUDE); \
	require_cmd jq spctl; \
	for triple in $(TARGETS); do \
		label="$$(arch_label "$$triple")"; \
		bd="$$(bundle_dir "$$triple")"; \
		dmg="$$(ls "$$bd"/dmg/*.dmg 2>/dev/null | head -n1 || true)"; \
		[ -f "$$dmg" ] || die "no $$label .dmg found under $$bd/dmg - run 'make build' first"; \
		echo "==> Verifying Gatekeeper acceptance for $$dmg ($$label)"; \
		spctl -a -vvv --type install "$$dmg" 2>&1 | grep -q "source=Notarized Developer ID" || die "$$label dmg is not notarized/accepted by Gatekeeper"; \
		echo "OK: notarized Developer ID build ($$label)"; \
	done

# --- publish (upload built artifacts to a GitHub Release) -------------------
# Each release carries, per architecture: a versioned .dmg (human download), a
# constant-named .dmg (the stable URL the landing page links to), and the updater
# tarball - plus one shared latest.json (the updater feed) whose two platform
# entries each point at that arch's tarball + signature. The stable .dmgs and
# latest.json keep the same name every release, so `releases/latest/download/<name>`
# always resolves to the newest build. GitHub auth comes from `gh` (run `gh auth login` once).
#
# Source-leak guard: GitHub attaches "Source code (zip/tar.gz)" to every release,
# generated from the release tag's git tree in GH_REPO (the public distribution repo,
# which holds only release docs - no app source). Those two links cannot be removed
# via the API. After publishing we assert the tag's tree contains nothing but the
# allowed distribution files, so the auto-archives can never expose the (private)
# application source. DIST_TREE_ALLOWED is the exact set of paths permitted at the tag.
DIST_TREE_ALLOWED := ^(README\.md|RELEASE_NOTE\.md|LICENSE|LICENSE\.md|\.gitignore)$$
publish:
	@$(PRELUDE); \
	require_cmd jq gh; \
	gh auth status >/dev/null 2>&1 || die "gh is not authenticated - run 'gh auth login'"; \
	ver="$$(jq -r .version "$(CONF)")"; \
	tag="v$$ver"; \
	notes_file="$(REPO_ROOT)/release/RELEASE_NOTE_v_$$(echo "$$ver" | tr . _).md"; \
	if [ -f "$$notes_file" ]; then \
		echo "==> Release body from $$notes_file"; \
		notes_args=(--notes-file "$$notes_file"); \
	else \
		echo "warning: no release note at $$notes_file - falling back to default body 'Arris $$ver'"; \
		notes_args=(--notes "Arris $$ver"); \
	fi; \
	staging="$$(mktemp -d)"; \
	uploads=(); \
	sig_aarch64=""; sig_x64=""; url_aarch64=""; url_x64=""; \
	for triple in $(TARGETS); do \
		label="$$(arch_label "$$triple")"; \
		bd="$$(bundle_dir "$$triple")"; \
		dmg="$$(ls "$$bd"/dmg/*.dmg 2>/dev/null | head -n1 || true)"; \
		tarball="$$(ls "$$bd"/macos/*.app.tar.gz 2>/dev/null | head -n1 || true)"; \
		sig="$$(ls "$$bd"/macos/*.app.tar.gz.sig 2>/dev/null | head -n1 || true)"; \
		[ -f "$$dmg" ] || die "no $$label .dmg found under $$bd/dmg - run 'make build' first"; \
		[ -f "$$tarball" ] || die "no $$label updater tarball found - run 'make build' first"; \
		[ -f "$$sig" ] || die "no $$label updater signature found - run 'make build' first"; \
		dmg_versioned="$(PRODUCT)_$${ver}_$${label}.dmg"; \
		dmg_stable="$(PRODUCT)-$${label}.dmg"; \
		tarball_name="$(PRODUCT)-$${label}.app.tar.gz"; \
		cp "$$dmg" "$$staging/$$dmg_versioned"; \
		cp "$$dmg" "$$staging/$$dmg_stable"; \
		cp "$$tarball" "$$staging/$$tarball_name"; \
		uploads+=("$$staging/$$dmg_versioned" "$$staging/$$dmg_stable" "$$staging/$$tarball_name"); \
		url="https://github.com/$(GH_REPO)/releases/download/$$tag/$$tarball_name"; \
		signature="$$(cat "$$sig")"; \
		if [ "$$label" = "aarch64" ]; then sig_aarch64="$$signature"; url_aarch64="$$url"; else sig_x64="$$signature"; url_x64="$$url"; fi; \
	done; \
	jq -n --arg version "$$ver" --arg sa "$$sig_aarch64" --arg ua "$$url_aarch64" --arg sx "$$sig_x64" --arg ux "$$url_x64" '{ version: $$version, notes: ("Arris " + $$version), platforms: { "darwin-aarch64": { signature: $$sa, url: $$ua }, "darwin-x86_64": { signature: $$sx, url: $$ux } } }' > "$$staging/latest.json"; \
	uploads+=("$$staging/latest.json"); \
	if gh release view "$$tag" --repo "$(GH_REPO)" >/dev/null 2>&1; then \
		echo "==> Updating existing GitHub release $$tag"; \
		gh release upload "$$tag" --repo "$(GH_REPO)" --clobber "$${uploads[@]}"; \
		gh release edit "$$tag" --repo "$(GH_REPO)" "$${notes_args[@]}"; \
	else \
		echo "==> Creating GitHub release $$tag"; \
		gh release create "$$tag" --repo "$(GH_REPO)" --title "Arris $$ver" "$${notes_args[@]}" "$${uploads[@]}"; \
	fi; \
	rm -rf "$$staging"; \
	echo "==> Guard: verifying release tag '$$tag' in $(GH_REPO) exposes no source"; \
	sha="$$(gh api "repos/$(GH_REPO)/commits/$$tag" --jq .sha 2>/dev/null || true)"; \
	[ -n "$$sha" ] || die "could not resolve tag '$$tag' in $(GH_REPO) to verify its tree"; \
	leaked=""; \
	while IFS= read -r p; do \
		[ -n "$$p" ] || continue; \
		[[ "$$p" =~ $(DIST_TREE_ALLOWED) ]] || leaked="$$leaked $$p"; \
	done < <(gh api "repos/$(GH_REPO)/git/trees/$$sha?recursive=1" --jq '.tree[] | select(.type=="blob") | .path'); \
	[ -z "$$leaked" ] || die "release tag '$$tag' in $(GH_REPO) contains non-distribution files - GitHub's auto-generated Source code archives would leak:$$leaked"; \
	echo "OK: '$$tag' tree is distribution-only; GitHub's Source code archives carry no app source"; \
	echo ""; \
	echo "Released $(PRODUCT) v$$ver"; \
	echo "  DMG (Apple Silicon): https://github.com/$(GH_REPO)/releases/latest/download/$(PRODUCT)-aarch64.dmg"; \
	echo "  DMG (Intel):         https://github.com/$(GH_REPO)/releases/latest/download/$(PRODUCT)-x64.dmg"; \
	echo "  Updater feed:        https://github.com/$(GH_REPO)/releases/latest/download/latest.json"

# --- release (build then publish) -------------------------------------------
release: build publish

# --- docs-deploy (build docs + direct-upload to Cloudflare Pages) -----------
# Mirrors the dashboard's "Drag and drop your files" flow: builds the static
# site, then uploads docs/dist straight to the Pages project via wrangler (the
# CLI for direct-upload deploys). The first deploy creates the project if it
# does not exist. Auth comes from CLOUDFLARE_API_TOKEN in .env, or a prior
# `npx wrangler login`. --branch main marks the upload as a production deploy.
docs-deploy:
	@$(PRELUDE); \
	require_cmd npx npm; \
	if [ -z "$${CLOUDFLARE_API_TOKEN:-}" ]; then \
		echo "note: CLOUDFLARE_API_TOKEN not set"; \
	fi; \
	[ -d "$(DOCS_DIR)/node_modules" ] || ( echo "==> Installing docs dependencies"; cd "$(DOCS_DIR)" && npm install ); \
	echo "==> Building docs site"; \
	( cd "$(DOCS_DIR)" && npm run build ); \
	echo "==> Deploying docs/dist to Cloudflare Pages project '$(CF_PAGES_PROJECT)'"; \
	( cd "$(DOCS_DIR)" && npx --yes wrangler pages deploy dist --project-name "$(CF_PAGES_PROJECT)" --branch main )

# --- clean ------------------------------------------------------------------
clean:
	@$(PRELUDE); \
	require_cmd jq cargo; \
	for triple in $(TARGETS); do \
		bd="$$(bundle_dir "$$triple")"; \
		echo "==> Removing $$bd"; \
		rm -rf "$$bd"; \
	done
