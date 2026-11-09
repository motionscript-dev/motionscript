#!/bin/sh
# Builds ms-render3d (crates/render3d) on its own with its wasm-bindgen entry into
# web/pkg-r3d; CI checks it builds and that the committed .d.ts is current.
set -e
cd "$(dirname "$0")/.."
. scripts/wasm-env.sh
cargo build --locked -p ms-render3d --features wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --remove-name-section --remove-producers-section --out-dir web/pkg-r3d target/wasm32-unknown-unknown/release/ms_render3d.wasm
printf 'ms_render3d_bg.wasm: %s bytes raw, %s bytes gzip -9\n' \
  "$(wc -c < web/pkg-r3d/ms_render3d_bg.wasm | tr -d ' ')" \
  "$(gzip -9 -c web/pkg-r3d/ms_render3d_bg.wasm | wc -c | tr -d ' ')"
