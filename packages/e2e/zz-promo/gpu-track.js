// Scratch: counts every GPUTexture/GPUBuffer by label — bytes made, destroyed, and only garbage-collected.
(() => {
    if (typeof GPUDevice === 'undefined') return;
    const BPP = {
        r8unorm: 1, r16float: 2, rg8unorm: 2, r32float: 4, rg16float: 4, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4,
        'bgra8unorm-srgb': 4, rgb10a2unorm: 4, depth32float: 4, depth24plus: 4, 'depth24plus-stencil8': 4, depth16unorm: 2,
        rgba16float: 8, rg32float: 8, rgba32float: 16, 'depth32float-stencil8': 8,
    };
    const stats = new Map();
    const s = (label) => {
        let v = stats.get(label);
        if (!v) stats.set(label, (v = { made: 0, madeB: 0, destroyed: 0, destroyedB: 0, gced: 0, gcedB: 0 }));
        return v;
    };
    const meta = new WeakMap();
    const reg = new FinalizationRegistry((m) => {
        if (m.destroyed) return;
        const v = s(m.label);
        v.gced++;
        v.gcedB += m.bytes;
    });
    const track = (obj, kind, label, bytes) => {
        const m = { label: `${kind}:${label || '?'}`, bytes, destroyed: false };
        meta.set(obj, m);
        reg.register(obj, m);
        const v = s(m.label);
        v.made++;
        v.madeB += bytes;
    };
    const texBytes = (d) => {
        const sz = d.size;
        const [w, h, z] = Array.isArray(sz) ? [sz[0], sz[1] ?? 1, sz[2] ?? 1] : [sz.width, sz.height ?? 1, sz.depthOrArrayLayers ?? 1];
        const bpp = BPP[d.format] ?? 4;
        let total = 0;
        for (let l = 0; l < (d.mipLevelCount ?? 1); l++) total += Math.max(1, w >> l) * Math.max(1, h >> l);
        return total * z * bpp * (d.sampleCount ?? 1);
    };
    const createTexture = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (d) {
        const t = createTexture.call(this, d);
        track(t, 'tex', d.label, texBytes(d));
        return t;
    };
    const createBuffer = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (d) {
        const b = createBuffer.call(this, d);
        track(b, 'buf', d.label, d.size);
        return b;
    };
    for (const C of [GPUTexture, GPUBuffer]) {
        const destroy = C.prototype.destroy;
        C.prototype.destroy = function () {
            const m = meta.get(this);
            if (m && !m.destroyed) {
                m.destroyed = true;
                const v = s(m.label);
                v.destroyed++;
                v.destroyedB += m.bytes;
            }
            return destroy.call(this);
        };
    }
    globalThis.__gpuStats = () => {
        const rows = {};
        let held = 0;
        for (const [label, v] of stats) {
            // Held = made, neither destroyed nor collected yet.
            const heldB = v.madeB - v.destroyedB - v.gcedB;
            held += heldB;
            rows[label] = { ...v, heldB, leakedB: v.madeB - v.destroyedB };
        }
        return { held, rows, jsHeap: performance.memory?.usedJSHeapSize ?? 0 };
    };
})();
