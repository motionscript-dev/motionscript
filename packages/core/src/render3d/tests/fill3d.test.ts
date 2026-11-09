import { describe, expect, it } from 'vitest';
import { lerpFill3D, looksLikeAssetPath, resolveFill3D, type Fill3D } from '@/render3d/fill3d';
import { Fills } from '@/attributes/shape/fill/chain';
import { parseColor } from '@/attributes/shape/fill/color/parser';
import { Graphics2D } from '@/render/graphics2d';
import { Scene3D } from '@/render3d/scene3d';
import { Tex } from '@/render3d/builders';
import { isSurfaceTexture3D } from '@/render3d/texture';
import { Rect } from "@/components/builtins/geometry/geometry";

/** The surface texture a rasterized fill carries, narrowed for assertions. */
function surfaceOf(fill: Fill3D, options?: { width?: number; height?: number }) {
    const { map } = resolveFill3D(fill, options);
    if (map === undefined || typeof map === 'string' || !isSurfaceTexture3D(map)) {
        throw new Error('expected a surface texture');
    }
    return map;
}

describe('looksLikeAssetPath', () => {
    it('treats a leading slash or dot as a path', () => {
        expect(looksLikeAssetPath('/wood')).toBe(true);
        expect(looksLikeAssetPath('./wood')).toBe(true);
        expect(looksLikeAssetPath('../up/wood')).toBe(true);
    });

    it('decides by extension otherwise, ignoring case', () => {
        for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.avif', 'a.svg', 'a.ktx', 'a.ktx2', 'a.hdr', 'a.exr', 'a.mp4', 'a.webm', 'a.MOV']) {
            expect(looksLikeAssetPath(name), name).toBe(true);
        }
    });

    it('treats colours and bare names as not paths', () => {
        for (const name of ['tomato', '#ff0000', 'rgb(1, 2, 3)', 'wood', 'a.gif', 'png']) {
            expect(looksLikeAssetPath(name), name).toBe(false);
        }
    });
});

describe('resolveFill3D', () => {
    it('resolves undefined and null to nothing', () => {
        expect(resolveFill3D(undefined)).toEqual({});
        expect(resolveFill3D(null as unknown as Fill3D)).toEqual({});
    });

    it('keeps a colour string a colour, costing no texture', () => {
        expect(resolveFill3D('tomato')).toEqual({ color: 'tomato' });
        expect(resolveFill3D('#0b0d12')).toEqual({ color: '#0b0d12' });
    });

    it('turns an asset path string into a map', () => {
        expect(resolveFill3D('/wood.png')).toEqual({ map: '/wood.png' });
        expect(resolveFill3D('textures/wood.jpg')).toEqual({ map: 'textures/wood.jpg' });
    });

    it('keeps an all-numbers array a colour', () => {
        const color = [0.1, 0.2, 0.3, 1] as unknown as Fill3D;
        expect(resolveFill3D(color)).toEqual({ color });
    });

    it('rasterizes an array of layers rather than reading it as a colour', () => {
        const map = surfaceOf(['red', 'blue'] as unknown as Fill3D);
        expect(map.static).toBe(true);
        expect(map.width).toBe(512);
        expect(map.height).toBe(512);
    });

    it('passes a texture descriptor through as map: src, data and surface forms', () => {
        const image = { src: '/a.png' };
        const data = { data: new Uint8Array(4), width: 1, height: 1 };
        const surface = Tex.surface(new Graphics2D(), { width: 64, height: 32 });
        expect(resolveFill3D(image)).toEqual({ map: image });
        expect(resolveFill3D(data).map).toBe(data);
        expect(resolveFill3D(surface).map).toBe(surface);
    });

    it('reads a single solid layer as a colour', () => {
        const layer = { type: 'solid', color: 'tomato' } as unknown as Fill3D;
        expect(resolveFill3D(layer)).toEqual({ color: 'tomato' });
    });

    it('rasterizes a solid layer that carries opacity, blend or space, which a colour cannot express', () => {
        for (const extra of [{ opacity: 0.5 }, { blend: 'multiply' }, { space: 'parent' }]) {
            const layer = { type: 'solid', color: 'tomato', ...extra } as unknown as Fill3D;
            const resolved = resolveFill3D(layer);
            expect(resolved.color, JSON.stringify(extra)).toBeUndefined();
            expect(resolved.map, JSON.stringify(extra)).toBeDefined();
        }
    });

    it('binds a built Graphics2D as a surface with no static flag, sized 512 square by default', () => {
        const graphics = new Graphics2D();
        const map = surfaceOf(graphics as unknown as Fill3D);
        expect(map.source).toBe(graphics);
        expect(map.width).toBe(512);
        expect(map.height).toBe(512);
        expect(map.static).toBeUndefined();
        expect(map.identity).toBeUndefined();
    });

    it('binds a Node2D as a surface source with the requested buffer size', () => {
        const node = new Rect({ width: 10, height: 10 });
        const map = surfaceOf(node as unknown as Fill3D, { width: 256, height: 128 });
        expect(map.source).toBe(node);
        expect(map.width).toBe(256);
        expect(map.height).toBe(128);
        expect(map.static).toBeUndefined();
    });

    it('paints a gradient into a Graphics2D rect that fills the buffer, marked static', () => {
        const gradient = Fills.linearGradient(['red', 'blue']);
        const map = surfaceOf(gradient as unknown as Fill3D);
        expect(map.static).toBe(true);
        expect(map.width).toBe(512);

        const graphics = map.source as Graphics2D;
        expect(graphics).toBeInstanceOf(Graphics2D);
        const [rect, fill] = graphics.ops();
        expect(rect).toMatchObject({ kind: 'rect', state: { width: 512, height: 512 } });
        expect(fill.kind).toBe('fill');
    });

    it('honours a custom size in the buffer and in the derived identity', () => {
        const gradient = Fills.linearGradient(['red', 'blue']) as unknown as Fill3D;
        const small = surfaceOf(gradient, { width: 64, height: 32 });
        expect(small.width).toBe(64);
        expect(small.height).toBe(32);
        expect(small.identity).toMatch(/:64x32$/);
        expect(surfaceOf(gradient).identity).toMatch(/:512x512$/);
    });

    it('derives one identity for fills with the same layers, however they were built', () => {
        const a = surfaceOf(Fills.linearGradient(['red', 'blue']) as unknown as Fill3D);
        const b = surfaceOf(Fills.linearGradient(['red', 'blue']) as unknown as Fill3D);
        const c = surfaceOf(Fills.linearGradient(['red', 'green']) as unknown as Fill3D);
        expect(a.identity).toBeDefined();
        expect(a.identity).toBe(b.identity);
        expect(a.identity).not.toBe(c.identity);
        // A chain unwraps to its list, so the equivalent plain array keys the same.
        const plain = surfaceOf([...Fills.linearGradient(['red', 'blue']).list] as unknown as Fill3D);
        expect(plain.identity).toBe(a.identity);
    });

    it('keys an instance by object identity: two different scenes never share a texture', () => {
        const one = new Scene3D();
        const two = new Scene3D();
        const layerOf = (scene: Scene3D) => surfaceOf([...Fills.canvas3D(scene).list] as unknown as Fill3D);
        expect(layerOf(one).identity).toBe(layerOf(one).identity);
        expect(layerOf(one).identity).not.toBe(layerOf(two).identity);
    });

    it('routes a Scene3D through the chain arm, not as a 2D source', () => {
        const scene = new Scene3D();
        // A Scene3D exposes both `ops()` and `cameraDescriptor()`, and the second wins.
        const map = surfaceOf(scene as unknown as Fill3D);
        expect(map.static).toBe(true);
        expect(map.source).toBeInstanceOf(Graphics2D);
        expect(map.source).not.toBe(scene);
    });
});

describe('lerpFill3D', () => {
    it('interpolates two colour strings through the normalized colour space', () => {
        const mid = lerpFill3D('#000000', '#ffffff', 0.5) as unknown as number[];
        const black = parseColor('#000000');
        const white = parseColor('#ffffff');
        expect(mid).toHaveLength(4);
        for (let i = 0; i < 4; i++) expect(mid[i]).toBeCloseTo((black[i] + white[i]) / 2, 9);
    });

    it('returns the endpoints exactly at t = 0 and t = 1', () => {
        expect(lerpFill3D('#000000', '#ffffff', 0)).toEqual(parseColor('#000000'));
        expect(lerpFill3D('#000000', '#ffffff', 1)).toEqual(parseColor('#ffffff'));
    });

    it('interpolates a string against an already normalized colour, and a solid layer', () => {
        const to = [1, 1, 1, 1] as unknown as Fill3D;
        const mid = lerpFill3D('#000000', to, 0.5) as unknown as number[];
        expect(mid[0]).toBeCloseTo(0.5, 9);

        const layer = { type: 'solid', color: '#000000' } as unknown as Fill3D;
        const viaLayer = lerpFill3D(layer, to, 0.5) as unknown as number[];
        expect(viaLayer[0]).toBeCloseTo(0.5, 9);
    });

    it('holds the start value until t reaches 1 when either side is not a plain colour', () => {
        const from = '/a.png';
        const to = '/b.png';
        expect(lerpFill3D(from, to, 0)).toBe(from);
        expect(lerpFill3D(from, to, 0.99)).toBe(from);
        expect(lerpFill3D(from, to, 1)).toBe(to);
        expect(lerpFill3D(from, to, 1.5)).toBe(to);
    });

    it('snaps a colour to a texture, and a texture to a colour, rather than blending', () => {
        expect(lerpFill3D('red', '/b.png', 0.5)).toBe('red');
        expect(lerpFill3D('/a.png', 'red', 0.5)).toBe('/a.png');
        expect(lerpFill3D('red', '/b.png', 1)).toBe('/b.png');
    });

    it('does not allocate a texture for a rich fill, even on the snap path', () => {
        const gradient = Fills.linearGradient(['red', 'blue']) as unknown as Fill3D;
        // The input is handed back untouched, not resolved into a texture descriptor.
        expect(lerpFill3D(gradient, 'red', 0.5)).toBe(gradient);
        expect(lerpFill3D(gradient, 'red', 1)).toBe('red');
    });
});
