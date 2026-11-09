import { Effects, type LutEffect } from "@motionscript/core";
import type { AuxTexture } from "./_port";
import { definePort } from "./_pack.ts";

// Baked per table identity.
const baked = new WeakMap<Float32Array, AuxTexture>();
let serial = 0;

const toByte = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v * 255))) : 0);

// The cube unrolled into an N²×N strip: texel (r + b·N, g) holds (r, g, b).
// Entries past the table's end stay black, as the engine leaves them.
function bake(table: Float32Array, n: number): AuxTexture {
    const hit = baked.get(table);
    if (hit && hit.height === n) return hit;
    const width = n * n;
    const pixels = new Uint8ClampedArray(width * n * 4);
    for (let b = 0; b < n; b++) {
        for (let g = 0; g < n; g++) {
            for (let r = 0; r < n; r++) {
                const s = ((b * n + g) * n + r) * 3;
                const d = (g * width + b * n + r) * 4;
                pixels[d + 3] = 255;
                if (s + 2 >= table.length) continue;
                pixels[d] = toByte(table[s]);
                pixels[d + 1] = toByte(table[s + 1]);
                pixels[d + 2] = toByte(table[s + 2]);
            }
        }
    }
    const aux = { key: `lut-${serial++}`, width, height: n, pixels };
    baked.set(table, aux);
    return aux;
}

// A test look: a lifted, teal-and-orange grade with channel crosstalk.
function look(n: number): Float32Array {
    const t = new Float32Array(n * n * n * 3);
    for (let b = 0; b < n; b++) {
        for (let g = 0; g < n; g++) {
            for (let r = 0; r < n; r++) {
                const [R, G, B] = [r / (n - 1), g / (n - 1), b / (n - 1)];
                const i = ((b * n + g) * n + r) * 3;
                t[i] = 0.05 + 0.95 * Math.pow(R, 0.8);
                t[i + 1] = 0.85 * G + 0.1 * B + 0.03;
                t[i + 2] = 1 - Math.pow(1 - B, 1.4) * 0.9 - 0.08 * R;
            }
        }
    }
    return t;
}

let tables: [Float32Array, Float32Array] | null = null;

export default definePort<LutEffect>({
    type: "lut",
    surface: "shader",
    params: { size: "param", amount: "param" },
    uses: ["table"],
    prepare: (e) => (e.amount <= 0 || !Number.isInteger(e.size) || e.size < 2 ? null : {}),
    extras: (e) => ({ aux: bake(e.table, e.size) }),
    cases: () => {
        tables ??= [look(17), look(33)];
        return [
            Effects.lut({ table: tables[1], size: 33 }).list[0],
            Effects.lut({ table: tables[0], size: 17, amount: 0.6 }).list[0],
        ];
    },
});
