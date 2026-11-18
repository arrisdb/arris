use std::path::PathBuf;

const DIST_RELATIVE: &str = "../../frontend/dist";
const INDEX_FILE: &str = "index.html";
const PLACEHOLDER_DIR: &str = "web-placeholder";
const PLACEHOLDER_HTML: &str = "<!doctype html><div id=\"root\">arris web ui placeholder</div>";
const WEB_DIR_ENV: &str = "ARRIS_WEB_DIR";
const RELEASE_PROFILE: &str = "release";
const BUILD_KIND_ENV: &str = "ARRIS_BUILD_KIND";
const BUILD_KIND_RELEASE: &str = "release";
const BUILD_KIND_DEV: &str = "dev";
const MISSING_DIST_MESSAGE: &str = "frontend/dist/index.html is missing: run `npm --prefix frontend run build` before a release build";

fn main() {
    let dist = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join(DIST_RELATIVE);
    println!("cargo:rerun-if-changed={}", dist.display());
    let release = std::env::var("PROFILE").is_ok_and(|p| p == RELEASE_PROFILE);
    let dir = if dist.join(INDEX_FILE).is_file() {
        dist
    } else if release {
        panic!("{MISSING_DIST_MESSAGE}");
    } else {
        // Debug builds and tests run without node; the placeholder lives in OUT_DIR, not the tree.
        let dir = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join(PLACEHOLDER_DIR);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(INDEX_FILE), PLACEHOLDER_HTML).unwrap();
        dir
    };
    println!("cargo:rustc-env={WEB_DIR_ENV}={}", dir.display());
    // Release builds always embed the real UI (the placeholder panics above), so the kind marks both.
    let kind = if release {
        BUILD_KIND_RELEASE
    } else {
        BUILD_KIND_DEV
    };
    println!("cargo:rustc-env={BUILD_KIND_ENV}={kind}");
}
