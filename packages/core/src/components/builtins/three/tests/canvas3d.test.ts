import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas3D as Canvas3DComponent } from "@/components/builtins/three/canvas3d";
import { Box3D, AmbientLight3D, PointLight3D, Camera3D, Fog3D } from "@/components/builtins/three/three";
import { component2d } from "@/components/factory/component2d";
import { component3d } from "@/components/factory/component3d";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import * as View3D from "@/components/modules/view3d";
import { Graphics3D } from '@/render3d/graphics3d';
import { Scene3D, type Scene3DOp } from '@/render3d/scene3d';
import { resetInertWarnings3D } from '@/render3d/inert';
import { Tex } from '@/render3d/builders';
import { Fills } from '@/attributes/shape/fill/chain';
import { parseColor } from '@/attributes/shape/fill/color/parser';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import { NullRenderContext } from '@/render/null-render-context';
import type { Graphics2D } from '@/render/graphics2d';
import { attachScope } from '@/components/trees/node/node.fixtures';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';

/** The viewport, with the scene its render builds now: what these tests read. */
type Canvas3D = Canvas3DComponent & { _scene3D(): Scene3D };
const Canvas3D = Canvas3DComponent as unknown as new (props?: ConstructorParameters<typeof Canvas3DComponent>[0]) => Canvas3D;

/** A viewport of the built-in's state that adds to its scene: how a component extends the one Canvas3D builds. */
function viewExtending(key: string, extend: (scene: Scene3D) => void) {
    const View = component2d({
        key,
        state: { ...Paint.state, ...Flow.state, ...Corners.state, ...View3D.state },
        allowedChildren: ["2d", "3d"],
        render: (ctx, state) => View3D.draw(ctx, state, extend),
    });
    return View as unknown as new (props?: Record<string, unknown>) => Canvas3D;
}

/** A render context that keeps what the node handed it to draw. */
class CaptureContext extends NullRenderContext {
    readonly drawn: Graphics2D[] = [];
    protected override drawGraphics(graphics: Graphics2D): void {
        this.drawn.push(graphics);
    }
}

/** Lay `canvas` out and render it once, returning what it drew. */
function paint(canvas: Canvas3D): Graphics2D[] {
    canvas.attach(attachScope());
    canvas.layout({ x: 0, y: 0, width: 200, height: 100 }, new FakeMeasureContext());
    const ctx = new CaptureContext();
    canvas.render(ctx);
    return ctx.drawn;
}

const kinds = (ops: readonly Scene3DOp[]) => ops.map((op) => op.kind);
const lights = (scene: Scene3D) => scene.ops().filter((op): op is Extract<Scene3DOp, { kind: 'light' }> => op.kind === 'light');
const cameras = (scene: Scene3D) => scene.ops().filter((op) => op.kind === 'camera');

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    resetInertWarnings3D();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => warn.mockRestore());

describe('Canvas3D defaults', () => {
    it('declares the documented prop defaults', () => {
        const canvas = new Canvas3D();
        expect(canvas.maxPixelRatio).toBe(2);
        expect(canvas.antialias).toBe(true);
        expect(canvas.shadows).toBe(false);
        expect(canvas.tone).toBeUndefined();
        expect(canvas.exposure).toBeUndefined();
        expect(canvas.post).toBeUndefined();

        expect([canvas.orbit, canvas.elevation, canvas.zoom, canvas.fov]).toEqual([35, 20, 12, 45]);
        expect([canvas.ambientIntensity, canvas.keyIntensity]).toEqual([0.45, 2.4]);
        expect(canvas.ambientColor).toEqual(parseColor('#ffffff'));
        expect(canvas.keyColor).toEqual(parseColor('#ffffff'));

        expect([canvas.showGrid, canvas.gridSize, canvas.gridDivisions, canvas.gridMajorEvery]).toEqual([false, 40, 40, 5]);
        expect([canvas.showAxes, canvas.gridFade]).toEqual([false, 0.55]);
        expect(canvas.gridColor).toEqual(parseColor('#26292f'));
        expect(canvas.gridMajorColor).toEqual(parseColor('#363a42'));
        expect(canvas.axisXColor).toEqual(parseColor('#c8404f'));
        expect(canvas.axisZColor).toEqual(parseColor('#2f6fd0'));
        expect(canvas.gridFadeColor).toEqual(parseColor('#0b0d12'));
    });

    it('fills its parent unless it is given a size, with or without children', () => {
        expect(new Canvas3D().width).toBe('fill');
        expect(new Canvas3D().height).toBe('fill');
        expect(new Canvas3D({ children: [new Box3D()] }).width).toBe('fill');
        const sized = new Canvas3D({ width: 320 });
        expect(sized.width).toBe(320);
        expect(sized.height).toBe('fill');
    });
});

describe('Canvas3D scene composition', () => {
    it('records children first, then the default camera, then the default light rig', () => {
        const scene = new Canvas3D({ children: [new Box3D()] })._scene3D();
        expect(kinds(scene.ops())).toEqual(['push', 'mesh', 'pop', 'camera', 'light', 'light', 'light']);
    });

    it('records the grid after the children and before the camera and rig', () => {
        const scene = new Canvas3D({ showGrid: true, children: [new Box3D()] })._scene3D();
        expect(kinds(scene.ops())).toEqual(['push', 'mesh', 'pop', 'line', 'camera', 'light', 'light', 'light']);
    });

    it('builds the default camera from orbit, elevation, zoom and fov, with the stored orbit turned a quarter', () => {
        const scene = new Canvas3D({ children: [new Box3D()] })._scene3D();
        expect(scene.cameraDescriptor()).toEqual({
            type: 'perspective', fov: 45, orbit: 90 - 35, elevation: 20, distance: 12,
        });

        const custom = new Canvas3D({ orbit: 0, elevation: -10, zoom: 3, fov: 70, children: [new Box3D()] })._scene3D();
        expect(custom.cameraDescriptor()).toEqual({
            type: 'perspective', fov: 70, orbit: 90, elevation: -10, distance: 3,
        });
    });

    it('does not add a default camera when a Camera3D child states one', () => {
        const scene = new Canvas3D({
            children: [new Box3D(), new Camera3D({ fov: 30, position: [0, 0, 9] })],
        })._scene3D();
        expect(cameras(scene)).toHaveLength(1);
        expect(scene.cameraDescriptor()).toMatchObject({ type: 'perspective', fov: 30 });
    });

    it('builds the default rig: an ambient fill, a key from the front-right and a weaker rim from behind', () => {
        const rig = lights(new Canvas3D({ children: [new Box3D()] })._scene3D());
        expect(rig).toHaveLength(3);

        const [ambient, key, rim] = rig;
        expect(ambient.light).toEqual({ type: 'ambient', intensity: 0.45, color: parseColor('#ffffff') });
        expect(ambient.transform).toBeUndefined();

        expect(key.light).toEqual({ type: 'directional', intensity: 2.4, color: parseColor('#ffffff') });
        expect(key.transform).toEqual({ position: [4, 6, 3] });

        expect(rim.light).toMatchObject({ type: 'directional' });
        expect((rim.light as { intensity: number }).intensity).toBeCloseTo(2.4 * 0.35, 12);
        expect(rim.transform).toEqual({ position: [-5, -2, -4] });
    });

    it('derives the rim from the key: same colour, 0.35 of its strength', () => {
        const rig = lights(new Canvas3D({
            keyIntensity: 4, keyColor: '#ff0000', ambientIntensity: 0.1, ambientColor: '#00ff00',
            children: [new Box3D()],
        })._scene3D());
        const [ambient, key, rim] = rig;
        expect(ambient.light).toMatchObject({ intensity: 0.1, color: parseColor('#00ff00') });
        expect(key.light).toMatchObject({ intensity: 4, color: parseColor('#ff0000') });
        expect(rim.light).toMatchObject({ intensity: 4 * 0.35, color: parseColor('#ff0000') });
    });

    it('leaves the rig out as soon as any child records a light', () => {
        const withAmbient = new Canvas3D({ children: [new Box3D(), new AmbientLight3D({ intensity: 1 })] })._scene3D();
        expect(lights(withAmbient)).toHaveLength(1);
        expect(lights(withAmbient)[0].light).toMatchObject({ type: 'ambient', intensity: 1 });

        const withPoint = new Canvas3D({ children: [new PointLight3D({ intensity: 3 })] })._scene3D();
        expect(lights(withPoint).map((l) => l.light.type)).toEqual(['point']);
        // The camera default still applies: only the slot a child filled is skipped.
        expect(cameras(withPoint)).toHaveLength(1);
    });

    it('a view that adds to its scene still gets the default camera and rig', () => {
        const Custom = viewExtending('customView', (scene) => scene.draw(new Graphics3D().box()));
        const scene = new Custom()._scene3D();
        expect(scene.isEmpty()).toBe(false);
        expect(cameras(scene)).toHaveLength(1);
        expect(lights(scene)).toHaveLength(3);
        expect(kinds(scene.ops()).at(-1)).toBe('mesh');
    });

    it('an HUD-only viewport has nothing to frame or light: no camera, no rig', () => {
        const scene = new Canvas3D({ children: [new Text({ text: 'hud' })] })._scene3D();
        expect(scene.ops()).toEqual([]);
        expect(scene.cameraDescriptor()).toBeNull();
    });
});

describe('Canvas3D render settings', () => {
    const scene = (props: Record<string, unknown>) =>
        new Canvas3D({ ...props, children: [new Box3D()] } as never)._scene3D();

    it('records no shadow, tone or post settings by default', () => {
        const built = scene({});
        expect(built.shadowSettings()).toBeNull();
        expect(built.toneSettings()).toBeNull();
        expect(built.postEffects()).toEqual([]);
    });

    it('turns shadows on with a switch or a quality', () => {
        expect(scene({ shadows: true }).shadowSettings()).toEqual({ enabled: true });
        expect(scene({ shadows: { quality: 'high' } }).shadowSettings()).toEqual({ enabled: true, quality: 'high' });
        expect(scene({ shadows: false }).shadowSettings()).toBeNull();
    });

    it('records tone mapping and exposure when either is set', () => {
        expect(scene({ tone: 'aces' }).toneSettings()).toEqual({ mapping: 'aces', exposure: undefined });
        expect(scene({ exposure: 1.4 }).toneSettings()).toEqual({ mapping: undefined, exposure: 1.4 });
        expect(scene({ tone: 'none', exposure: 0.5 }).toneSettings()).toEqual({ mapping: 'none', exposure: 0.5 });
    });

    it('keeps a stated exposure of zero rather than treating it as unset', () => {
        expect(scene({ exposure: 0 }).toneSettings()).toEqual({ mapping: undefined, exposure: 0 });
    });

    it('records a single post pass or a chain, in order', () => {
        expect(scene({ post: { type: 'bloom' } }).postEffects().map((e) => e.type)).toEqual(['bloom']);
        expect(scene({ post: [{ type: 'ssao' }, { type: 'bloom' }] }).postEffects().map((e) => e.type))
            .toEqual(['ssao', 'bloom']);
        // No backend applies a pass, so the first one set says so.
        expect(warn).toHaveBeenCalled();
    });
});

describe('Canvas3D fog colour', () => {
    const fogOf = (props: Record<string, unknown>, fog = new Fog3D({ near: 5, far: 30 })) =>
        new Canvas3D({ ...props, children: [fog, new Box3D()] } as never)._scene3D().fogDescriptor();

    it('gives a fog with no colour the first solid layer of the viewport fill', () => {
        expect(fogOf({ fill: '#102030' })).toEqual({ near: 5, far: 30, color: parseColor('#102030') });
    });

    it('reads past a gradient to the first solid layer of a stack', () => {
        const fill = [Fills.linearGradient(['red', 'blue']).list[0], { type: 'solid', color: '#336699' }];
        expect(fogOf({ fill })?.color).toEqual(parseColor('#336699'));
    });

    it('leaves the fog colourless when the fill has no solid layer', () => {
        expect(fogOf({ fill: Fills.linearGradient(['red', 'blue']) })?.color).toBeUndefined();
    });

    it('keeps a fog colour the author stated', () => {
        const fog = fogOf({ fill: '#102030' }, new Fog3D({ color: '#ffffff', near: 1, far: 2 }));
        expect(fog?.color).toEqual(parseColor('#ffffff'));
    });

    it('records no fog at all when no Fog3D child exists, whatever the fill', () => {
        expect(new Canvas3D({ fill: '#102030', children: [new Box3D()] })._scene3D().fogDescriptor()).toBeNull();
    });
});

describe('Canvas3D grid', () => {
    const gridOp = (canvas: Canvas3D) => {
        const op = canvas._scene3D().ops().find((o) => o.kind === 'line');
        if (op?.kind !== 'line') throw new Error('no grid recorded');
        return op;
    };
    /** The vertex buffers of the recorded grid. */
    const buffers = (canvas: Canvas3D) =>
        gridOp(canvas).geometry as unknown as { position: Float32Array; color: Float32Array };
    const grid = (props: Record<string, unknown> = {}) =>
        new Canvas3D({ showGrid: true, gridSize: 8, gridDivisions: 4, gridMajorEvery: 2, ...props } as never);

    it('is absent unless showGrid is set', () => {
        expect(new Canvas3D({ children: [new Box3D()] })._scene3D().ops().some((o) => o.kind === 'line')).toBe(false);
    });

    it('is one segments line over a static buffer, drawn with an unlit vertex-coloured material', () => {
        const op = gridOp(grid());
        expect(op.mode).toBe('segments');
        expect(op.material).toEqual({ type: 'lineBasic', vertexColors: true, toneMapped: false });
        expect(op.geometry).toMatchObject({ type: 'buffer', staticData: true, computeNormals: false });
    });

    it('lays out divisions + 1 lines each way, as segments of two vertices', () => {
        const { position, color } = buffers(grid());
        // 5 lines across and 5 deep, 2 vertices each, 3 floats per vertex.
        expect(position.length).toBe(5 * 2 * 2 * 3);
        expect(color.length).toBe(position.length);
    });

    it('spans +-size/2 on the ground plane, y = 0', () => {
        const { position } = buffers(grid());
        let extent = 0;
        for (let i = 0; i < position.length; i += 3) {
            expect(position[i + 1]).toBe(0);
            extent = Math.max(extent, Math.abs(position[i]), Math.abs(position[i + 2]));
        }
        expect(extent).toBe(4);
    });

    it('rounds and floors the division and major-every counts at 1', () => {
        const rounded = buffers(grid({ gridDivisions: 3.6 }));
        expect(rounded.position.length).toBe(5 * 2 * 2 * 3);
        const floored = buffers(grid({ gridDivisions: 0, gridMajorEvery: 0 }));
        expect(floored.position.length).toBe(2 * 2 * 2 * 3);
    });

    it('fades the far corner fully into the colour of the fill behind it, in linear light', () => {
        // sRGB 1.0 and 0.0 are fixed points of the transfer function.
        const { color } = buffers(grid({ fill: '#ff0000', gridFade: 1 }));
        expect([color[0], color[1], color[2]]).toEqual([1, 0, 0]);
    });

    it('falls back to gridFadeColor when the fill has no solid layer', () => {
        const fill = Fills.linearGradient(['white', 'black']);
        const { color } = buffers(grid({ fill, gridFade: 1, gridFadeColor: '#00ff00' }));
        expect([color[0], color[1], color[2]]).toEqual([0, 1, 0]);
    });

    it('passes over a fully transparent solid layer rather than fading into nothing', () => {
        const fill = [{ type: 'solid', color: [1, 0, 0, 0] }, { type: 'solid', color: '#0000ff' }];
        const { color } = buffers(grid({ fill, gridFade: 1 }));
        expect([color[0], color[1], color[2]]).toEqual([0, 0, 1]);
    });

    it('draws the minor lines in gridColor, converted to linear, where the fade has not started', () => {
        const { color } = buffers(grid({ gridFade: 0, gridColor: '#ff0000', gridMajorColor: '#ff0000' }));
        expect([color[0], color[1], color[2]]).toEqual([1, 0, 0]);
        // 0x80/255 = 0.50196 in sRGB is about 0.2158 in linear light, not 0.50196.
        const mid = buffers(grid({ gridFade: 0, gridColor: '#808080', gridMajorColor: '#808080' }));
        expect(mid.color[0]).toBeCloseTo(0.2158, 3);
    });

    it('caches the buffer across scenes until one of its fields moves', () => {
        const canvas = grid({ children: [new Box3D()] });
        const first = gridOp(canvas).geometry;
        expect(gridOp(canvas).geometry).toBe(first);

        // Unrelated fields do not rebuild it.
        canvas.set({ orbit: 80, keyIntensity: 1 } as never);
        expect(gridOp(canvas).geometry).toBe(first);

        // One of its own does, so a tween through gridFade needs no invalidation.
        canvas.set({ gridFade: 0.2 } as never);
        const rebuilt = gridOp(canvas).geometry;
        expect(rebuilt).not.toBe(first);
        expect(gridOp(canvas).geometry).toBe(rebuilt);
    });

    it('keys the cache on the fade colour too, so a new background rebuilds it', () => {
        const canvas = grid({ fill: '#101010' });
        const first = gridOp(canvas).geometry;
        canvas.set({ fill: '#202020' } as never);
        expect(gridOp(canvas).geometry).not.toBe(first);
    });

    it('lets the axes replace the two centre lines with their own colours', () => {
        const withoutAxes = buffers(grid({ gridFade: 0 }));
        const withAxes = buffers(grid({
            gridFade: 0, showAxes: true, axisXColor: '#ff0000', axisZColor: '#0000ff',
        }));

        // The centre lines are swapped for the axes, so the vertex count is unchanged.
        expect(withAxes.position.length).toBe(withoutAxes.position.length);

        const colours = new Set<string>();
        for (let i = 0; i < withAxes.color.length; i += 3) {
            colours.add(`${withAxes.color[i]},${withAxes.color[i + 1]},${withAxes.color[i + 2]}`);
        }
        expect(colours.has('1,0,0')).toBe(true);
        expect(colours.has('0,0,1')).toBe(true);
    });
});

describe('Canvas3D render', () => {
    it('draws the shape filled with its own fill and nothing else when the scene is empty', () => {
        const canvas = new Canvas3D({ fill: '#102030', children: [new Text({ text: 'hud' })] });
        const [graphics] = paint(canvas);

        const fills = graphics.ops().find((op) => op.kind === 'fill');
        expect(fills?.kind === 'fill' && fills.fills).toBe(canvas.fill);
        expect(JSON.stringify(graphics.ops())).not.toContain('canvas3D');
    });

    it('paints the 3D as one more layer on top of the fill, with the pixel ratio and antialias options', () => {
        const canvas = new Canvas3D({
            fill: '#102030', maxPixelRatio: 1, antialias: false, children: [new Box3D()],
        });
        const [graphics] = paint(canvas);

        const op = graphics.ops().find((o) => o.kind === 'fill');
        if (op?.kind !== 'fill') throw new Error('no fill drawn');
        const layers = op.fills as unknown as { type: string; scene?: Scene3D; maxPixelRatio?: number; antialias?: boolean }[];
        expect(layers.map((layer) => layer.type)).toEqual(['solid', 'canvas3D']);
        expect(layers[1]).toMatchObject({ maxPixelRatio: 1, antialias: false });
        expect(layers[1].scene).toBeInstanceOf(Scene3D);
        expect(layers[1].scene?.isEmpty()).toBe(false);
    });

    it('defaults the pixel ratio to 2 and antialiasing on', () => {
        const [graphics] = paint(new Canvas3D({ children: [new Box3D()] }));
        const op = graphics.ops().find((o) => o.kind === 'fill');
        const layers = (op?.kind === 'fill' ? op.fills : []) as unknown as { type: string; maxPixelRatio?: number; antialias?: boolean }[];
        expect(layers.at(-1)).toMatchObject({ type: 'canvas3D', maxPixelRatio: 2, antialias: true });
    });

    it('binds a Node2D surface source of its scene to itself, so it has a catalog, context and clock', () => {
        const source = new Rect({ width: 16, height: 16 });
        const canvas = new Canvas3D({
            children: [new (component3d({
                key: 'surfacePlane',
                render: (ctx) => ctx.draw(new Graphics3D().plane({ fill: Tex.surface(source, { width: 16, height: 16 }) })),
            }))()],
        });

        expect(source.mounted).toBe(false);
        paint(canvas);
        expect(source.mounted).toBe(true);
    });

    it('throws at the author when a scene is left unbalanced', () => {
        const Unbalanced = viewExtending('unbalancedView', (scene) => {
            scene.begin({ id: 'leak' });
            scene.draw(new Graphics3D().box());
        });
        expect(() => paint(new Unbalanced())).toThrow(/unclosed begin/);
    });
});
