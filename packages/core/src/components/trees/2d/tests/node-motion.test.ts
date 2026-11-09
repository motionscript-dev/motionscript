import { describe, it, expect } from 'vitest';
import {
    MAX_MOTION_DT, createMotionHistory, primeMotion, sampleMotion, type MotionHistory,
} from '@/components/trees/2d/node-motion';
import { primeMotionTree, sampleTree } from '@/components/trees/node/node-walk';
import { Rect } from "@/components/builtins/geometry/geometry";
import { attachScope } from '@/components/trees/node/node.fixtures';
import { laidOut, RecordingContext } from '@/components/trees/tests/recording-context.fixtures';
import type { NodeRenderState } from '@/render/render-context2d';

const state = (): NodeRenderState => ({
    id: 'n', rects: {}, elapsed: 0, dt: 0, velocity: { x: 0, y: 0 }, direction: 0, speed: 0, angularVelocity: 0, scaleVelocity: 0,
});

/** A history that has seen one frame, at `t = 0` and the origin. */
function seen(at = 0, x = 0, y = 0, rotation = 0, scale = 1): MotionHistory {
    const history = createMotionHistory();
    sampleMotion(state(), history, x, y, rotation, scale, at);
    return history;
}

describe('sampleMotion – a trusted delta', () => {
    it('derives velocity as the backward difference over the frame', () => {
        const s = state();
        sampleMotion(s, seen(0, 0, 0), 30, -40, 0, 1, 0.1);
        expect(s.dt).toBeCloseTo(0.1, 12);
        expect(s.velocity.x).toBeCloseTo(300, 9);
        expect(s.velocity.y).toBeCloseTo(-400, 9);
        expect(s.speed).toBeCloseTo(500, 9);
    });

    it('points the direction along the velocity, in degrees, y-down', () => {
        const s = state();
        sampleMotion(s, seen(0, 0, 0), 10, 10, 0, 1, 0.1);
        expect(s.direction).toBeCloseTo(45, 9);
        sampleMotion(s, seen(0, 0, 0), -10, 0, 0, 1, 0.1);
        expect(s.direction).toBeCloseTo(180, 9);
        sampleMotion(s, seen(0, 0, 0), 0, -10, 0, 1, 0.1);
        expect(s.direction).toBeCloseTo(-90, 9);
    });

    it('derives angular and scale velocity from the same delta', () => {
        const s = state();
        sampleMotion(s, seen(0, 0, 0, 10, 1), 0, 0, 40, 2, 0.1);
        expect(s.angularVelocity).toBeCloseTo(300, 9);
        expect(s.scaleVelocity).toBeCloseTo(10, 9);
    });

    it('reads zero velocity for a node that stood still across a trusted frame', () => {
        const s = state();
        sampleMotion(s, seen(0, 5, 5), 5, 5, 0, 1, 1 / 60);
        expect(s.velocity).toEqual({ x: 0, y: 0 });
        expect(s.speed).toBe(0);
        expect(s.dt).toBeCloseTo(1 / 60, 12);
    });

    it('trusts a delta right up to the limit, and no further', () => {
        expect(MAX_MOTION_DT).toBe(0.2);
        const atLimit = state();
        sampleMotion(atLimit, seen(0, 0, 0), 10, 0, 0, 1, MAX_MOTION_DT);
        expect(atLimit.speed).toBeCloseTo(50, 9);
        const past = state();
        sampleMotion(past, seen(0, 0, 0), 10, 0, 0, 1, MAX_MOTION_DT + 1e-6);
        expect(past.speed).toBe(0);
    });

    it('rolls the history forward, so the next frame differences against this one', () => {
        const history = seen(0, 0, 0);
        const s = state();
        sampleMotion(s, history, 10, 0, 0, 1, 0.1);
        sampleMotion(s, history, 12, 0, 0, 1, 0.2);
        expect(s.velocity.x).toBeCloseTo(20, 9);
        expect(history.prevPos).toEqual({ x: 12, y: 0 });
        expect(history.prevTime).toBe(0.2);
    });

    it('writes into the state it is handed, reusing its velocity object', () => {
        const s = state();
        const velocity = s.velocity;
        sampleMotion(s, seen(), 10, 0, 0, 1, 0.1);
        expect(s.velocity).toBe(velocity);
    });
});

describe('sampleMotion – a delta it cannot trust', () => {
    function unknown(s: NodeRenderState): void {
        expect(s.dt).toBe(0);
        expect(s.velocity).toEqual({ x: 0, y: 0 });
        expect(s.speed).toBe(0);
        expect(s.direction).toBe(0);
        expect(s.angularVelocity).toBe(0);
        expect(s.scaleVelocity).toBe(0);
    }

    it('reads the first frame as unknown, there being nothing to difference against', () => {
        const s = state();
        s.velocity.x = 99;
        s.speed = 99;
        sampleMotion(s, createMotionHistory(), 100, 100, 45, 2, 5);
        unknown(s);
    });

    it('reads a scrub forward past the limit as unknown, not as a huge velocity', () => {
        const s = state();
        sampleMotion(s, seen(0, 0, 0), 1000, 0, 0, 1, 3);
        unknown(s);
    });

    it('reads a scrub backward as unknown', () => {
        const s = state();
        sampleMotion(s, seen(2, 0, 0), 500, 0, 0, 1, 1.95);
        unknown(s);
    });

    it('reads a repeat of the same time as unknown: a paused playhead has no velocity', () => {
        const s = state();
        sampleMotion(s, seen(1, 0, 0), 50, 0, 0, 1, 1);
        unknown(s);
    });

    it('clears a velocity left over from the frame before', () => {
        const s = state();
        const history = seen(0, 0, 0);
        sampleMotion(s, history, 10, 0, 0, 1, 0.1);
        expect(s.speed).toBeGreaterThan(0);
        sampleMotion(s, history, 20, 0, 0, 1, 4);
        unknown(s);
    });

    it('still rolls the history forward from an unknown frame, so the next one is trusted', () => {
        const history = seen(0, 0, 0);
        const s = state();
        sampleMotion(s, history, 100, 0, 0, 1, 5);
        sampleMotion(s, history, 110, 0, 0, 1, 5.1);
        expect(s.velocity.x).toBeCloseTo(100, 9);
    });
});

describe('primeMotion – seeding the history without a velocity', () => {
    it('records the position as the previous frame, stamped at the given time', () => {
        const history = createMotionHistory();
        primeMotion(history, 4, 5, 30, 2, 0.5);
        expect(history).toEqual({ prevPos: { x: 4, y: 5 }, prevTime: 0.5, prevRotation: 30, prevScale: 2 });
    });

    it('derives no velocity of its own, there being no state to write', () => {
        const s = state();
        s.speed = 7;
        primeMotion(createMotionHistory(), 100, 100, 0, 1, 1);
        expect(s.speed).toBe(7);
    });

    it('lets the next sample difference against the primed position, however the playhead got there', () => {
        const history = createMotionHistory();
        primeMotion(history, 0, 0, 0, 1, 0.9);
        const s = state();
        sampleMotion(s, history, 10, 0, 0, 1, 1);
        expect(s.velocity.x).toBeCloseTo(100, 9);
    });

    it('overwrites a history that has moved on, so a seek reads the same as a fresh start', () => {
        const history = seen(5, 900, 900, 90, 4);
        primeMotion(history, 0, 0, 0, 1, 0.9);
        const s = state();
        sampleMotion(s, history, 10, 0, 0, 1, 1);
        expect(s.velocity.x).toBeCloseTo(100, 9);
        expect(s.angularVelocity).toBeCloseTo(0, 9);
        expect(s.scaleVelocity).toBeCloseTo(0, 9);
    });

    it('reuses the position object once it has one, rather than allocating', () => {
        const history = createMotionHistory();
        primeMotion(history, 1, 1, 0, 1, 0);
        const pos = history.prevPos;
        primeMotion(history, 2, 3, 0, 1, 0.1);
        expect(history.prevPos).toBe(pos);
        expect(history.prevPos).toEqual({ x: 2, y: 3 });
    });

    it('is what makes a primed sample independent of where the playhead was', () => {
        const fromAfar = seen(8, 700, 700);
        const fromStart = createMotionHistory();
        for (const history of [fromAfar, fromStart]) primeMotion(history, 0, 0, 0, 1, 2.9);
        const a = state(), b = state();
        sampleMotion(a, fromAfar, 6, 0, 0, 1, 3);
        sampleMotion(b, fromStart, 6, 0, 0, 1, 3);
        expect(a).toEqual(b);
    });
});

describe('createMotionHistory', () => {
    it('starts with no position, so the first sample is unknown', () => {
        expect(createMotionHistory()).toEqual({ prevPos: null, prevTime: 0, prevRotation: 0, prevScale: 1 });
    });

    it('is a fresh object each time', () => {
        expect(createMotionHistory()).not.toBe(createMotionHistory());
    });
});

describe('a node\'s motion, through the clock', () => {
    function frames(node: Rect, ...times: Array<[number, Record<string, number>?]>): RecordingContext {
        const ctx = new RecordingContext();
        for (const [time, props] of times) {
            if (props) node.set(props as never);
            node.attach(attachScope(time));
            node.render(ctx);
        }
        return ctx;
    }

    it('reads a moving node\'s velocity from one advanced frame to the next', () => {
        const node = laidOut(new Rect({ id: 'n', width: 20, height: 20, x: 0 }));
        const ctx = frames(node, [0.1, { x: 0 }], [0.2, { x: 30 }]);
        const last = ctx.states[ctx.states.length - 1];
        expect(last.velocity.x).toBeCloseTo(300, 6);
        expect(last.speed).toBeCloseTo(300, 6);
        expect(last.dt).toBeCloseTo(0.1, 9);
    });

    it('reads the first advanced frame as unknown', () => {
        const node = laidOut(new Rect({ id: 'n', width: 20, height: 20, x: 50 }));
        const ctx = frames(node, [0.5]);
        expect(ctx.states[0].speed).toBe(0);
        expect(ctx.states[0].dt).toBe(0);
    });

    it('reads a jump across the clock as unknown, so a seek does not smear a static node', () => {
        const node = laidOut(new Rect({ id: 'n', width: 20, height: 20, x: 0 }));
        const ctx = frames(node, [0.1, { x: 0 }], [9, { x: 400 }]);
        expect(ctx.states[ctx.states.length - 1].speed).toBe(0);
    });

    it('samples the position the node is drawn at: its laid-out place plus x, with y flipped', () => {
        const node = laidOut(new Rect({ id: 'n', width: 20, height: 20, x: 0, y: 0 }), { x: 100, y: 50, width: 20, height: 20 });
        const ctx = frames(node, [0.1, { x: 0, y: 0 }], [0.2, { x: 10, y: 10 }]);
        const last = ctx.states[ctx.states.length - 1];
        // y is up for the author and down for the canvas: +10 in y is -10 in the sampled position.
        expect(last.velocity.x).toBeCloseTo(100, 6);
        expect(last.velocity.y).toBeCloseTo(-100, 6);
    });

    it('derives rotation and scale velocity from the node\'s own props', () => {
        const node = laidOut(new Rect({ id: 'n', width: 20, height: 20 }));
        const ctx = frames(node, [0.1, { rotation: 0, scale: 1 }], [0.2, { rotation: 20, scale: 1.5 }]);
        const last = ctx.states[ctx.states.length - 1];
        expect(last.angularVelocity).toBeCloseTo(200, 6);
        expect(last.scaleVelocity).toBeCloseTo(5, 6);
    });

    it('is primed by primeMotionTree and then sampled by sampleTree, without moving the clock', () => {
        const child = new Rect({ id: 'c', width: 10, height: 10, x: 0 });
        const root = laidOut(new Rect({ id: 'r', width: 100, height: 100, children: [child] }));
        root.attach(attachScope(1));
        primeMotionTree(root, 0.95);
        child.set({ x: 5 });
        sampleTree(root);
        const ctx = new RecordingContext();
        root.render(ctx);
        const state = ctx.states.find((s) => s.id === 'c')!;
        expect(state.velocity.x).toBeCloseTo(100, 6);
    });

    it('reads zero for a node a tree walk primed in place', () => {
        const root = laidOut(new Rect({ id: 'r', width: 100, height: 100, x: 40 }));
        root.attach(attachScope(1));
        primeMotionTree(root, 0.95);
        sampleTree(root);
        const ctx = new RecordingContext();
        root.render(ctx);
        expect(ctx.states[0].speed).toBe(0);
    });
});
