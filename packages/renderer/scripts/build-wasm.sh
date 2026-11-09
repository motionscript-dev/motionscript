#!/bin/sh
# Builds the Rust renderer to WASM and generates the JS bindings in web/pkg.
set -e
cd "$(dirname "$0")/.."
# CI restores web/pkg from a cache keyed on every Rust input and sets this.
if [ "$MS_WASM_CACHED" = "1" ] && [ -f web/pkg/ms_renderer_bg.wasm ]; then
  echo "web/pkg restored from cache; skipping the Rust build."
  exit 0
fi
. scripts/wasm-env.sh
cargo build --locked -p ms-renderer --target wasm32-unknown-unknown --release
wasm-bindgen --target web --remove-name-section --remove-producers-section --out-dir web/pkg target/wasm32-unknown-unknown/release/ms_renderer.wasm
printf 'ms_renderer_bg.wasm: %s bytes raw, %s bytes gzip -9\n' \
  "$(wc -c < web/pkg/ms_renderer_bg.wasm | tr -d ' ')" \
  "$(gzip -9 -c web/pkg/ms_renderer_bg.wasm | wc -c | tr -d ' ')"
