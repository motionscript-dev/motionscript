import { Parallax, Rect, Ellipse, Triangle } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Parallax} with four layers, back to front, wider than the frame: one `scrollTo` slides the sky a tenth as far as the posts in front. */
const view = createRef<Parallax>();
const steps = (from: number, to: number, by: number) => Array.from({ length: Math.floor((to - from) / by) + 1 }, (_, i) => from + i * by);
export default scene((stage) => {
    stage.set({ fill: '#0b0d12' });
    stage.add([
        el(Parallax, {
            ref: view, farSpeed: 0.1, nearSpeed: 1,
            children: [
                el(Rect, { width: 1400, height: 540, fill: '#1d2b4f', children: [
                    el(Ellipse, { x: 150, y: 120, width: 110, height: 110, fill: '#f5c451' }),
                ] }),
                el(Rect, { width: 1600, height: 180, y: -90, fill: '#3b4d7a', children: steps(-800, 800, 200).map((x) =>
                    el(Triangle, { x, y: 170, width: 220, height: 160, fill: '#3b4d7a' })) }),
                el(Rect, { width: 1800, height: 130, y: -165, fill: '#4f8a5b', children: steps(-700, 700, 280).map((x) =>
                    el(Ellipse, { x, y: 50, width: 240, height: 120, fill: '#4f8a5b' })) }),
                el(Rect, { width: 2200, height: 70, y: -235, fill: '#2b4a2f', children: steps(-1080, 1080, 180).map((x) =>
                    el(Rect, { x, y: 60, width: 18, height: 80, fill: '#f2c14e', cornerRadius: 4 })) }),
            ],
        }),
    ]);
}, [
    () => view().scrollTo({ data: { scroll: { x: 600, y: 0 } }, duration: 1.6, easing: easeInOut('quad') }),
    holdTail(1.6),
]);
