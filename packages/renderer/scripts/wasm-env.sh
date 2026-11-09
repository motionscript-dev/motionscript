# Sourced by the build-wasm*.sh scripts, from the package root: the pinned
# toolchain (rust-toolchain.toml) and the wasm-bindgen-cli the lockfile needs.
export PATH="$HOME/.cargo/bin:$PATH"
want=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p;}' Cargo.lock)
have=$(wasm-bindgen --version 2>/dev/null | cut -d' ' -f2)
if [ "$have" != "$want" ]; then
  echo "wasm-bindgen-cli is ${have:-missing}; Cargo.lock needs $want:" >&2
  echo "  cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi
# Absolute build paths reach the binary through panic locations; remapped so
# the WASM does not depend on where it was built.
here=$(pwd)
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
if command -v cygpath >/dev/null 2>&1; then
  here=$(cygpath -w "$here")
  cargo_home=$(cygpath -w "$cargo_home")
fi
CARGO_ENCODED_RUSTFLAGS=$(printf '%s\037%s' "--remap-path-prefix=$cargo_home=/cargo" "--remap-path-prefix=$here=/renderer")
export CARGO_ENCODED_RUSTFLAGS
