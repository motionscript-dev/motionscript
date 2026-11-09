import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene, stageCommand } from '../doc';
import { holdTail } from './_lib';

const ring = createRef<Rect>();

const COLORS = ['#e0533d', '#f2c14e', '#4fb286', '#3d6fe0', '#9b5de5', '#f15bb5'];
const RADIUS = 240;

/**
 * Nested groups share the space: a ring of cards turns as one group while each
 * card keeps its own place and tilt in it, the camera rises to look down on the
 * ring, and the cards paint front over back as they come round — the far side
 * of the ring shows through the gaps, behind.
 */
export default scene((stage) => {
    stage.set({ fill: '#0f1218', space3D: true, perspective: 1200, elevation: 8 });
    stage.add([
        el(Rect, { width: 1000, height: 1000, y: -130, rotationX: 90, cornerRadius: 500, fill: '#171c26' }),
        el(Rect, { ref: ring, width: 10, height: 10, children: [
            COLORS.map((fill, i) => {
                const angle = i * 60;
                const rad = (angle * Math.PI) / 180;
                return el(Rect, {
                    width: 140,
                    height: 200,
                    cornerRadius: 18,
                    fill,
                    stroke: { weight: 4, fill: 'white/40' },
                    x: RADIUS * Math.sin(rad),
                    depth: RADIUS * Math.cos(rad),
                    rotationY: angle,
                });
            }),
        ] }),
    ]);
}, [
    [
        () => ring().to({ data: { rotationY: 120 }, duration: 1.6, easing: easeInOut('cubic') }),
        () => stageCommand('orbitTo', { elevation: 24 }, 1.6, easeInOut('quad')),
    ],
    holdTail(1.6),
]);
