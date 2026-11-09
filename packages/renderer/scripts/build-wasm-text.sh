#!/bin/sh
# Builds ms-text (crates/text) on its own to WASM with its wasm-bindgen API into
# web/pkg-text; CI checks it builds and that the committed .d.ts is current.
set -e
cd "$(dirname "$0")/.."
. scripts/wasm-env.sh
cargo build --locked -p ms-text --features wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --remove-name-section --remove-producers-section --out-dir web/pkg-text target/wasm32-unknown-unknown/release/ms_text.wasm
printf 'ms_text_bg.wasm: %s bytes raw, %s bytes gzip -9\n' \
  "$(wc -c < web/pkg-text/ms_text_bg.wasm | tr -d ' ')" \
  "$(gzip -9 -c web/pkg-text/ms_text_bg.wasm | wc -c | tr -d ' ')"
