import { Parallax, Rect, Ellipse, Triangle } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Parallax} with `wrap: 'horizontal'`: layers far narrower than the frame tile edge to edge, so a scroll of two frames shows no edge or seam. */
const view = createRef<Parallax>();
export default scene((stage) => {
    stage.set({ fill: '#0b0d12' });
    stage.add([
        el(Parallax, {
            ref: view, farSpeed: 0.15, nearSpeed: 1, wrap: 'horizontal',
            children: [
                el(Rect, { width: 'fill', height: 'fill', fill: '#141a2b' }),
                el(Triangle, { width: 320, height: 200, y: -40, fill: '#3b4d7a' }),
                el(Ellipse, { width: 260, height: 120, y: -170, fill: '#4f8a5b' }),
                el(Rect, { width: 210, height: 200, y: -170, fill: 'black/0', children: [
                    el(Rect, { y: -75, width: 210, height: 50, fill: '#2b4a2f' }),
                    el(Triangle, { x: -40, width: 60, height: 110, fill: '#1f3a24' }),
                ] }),
            ],
        }),
    ]);
}, [
    () => view().scrollTo({ data: { scroll: { x: 2000, y: 0 } }, duration: 1.6, easing: linear() }),
    holdTail(1.6),
]);
