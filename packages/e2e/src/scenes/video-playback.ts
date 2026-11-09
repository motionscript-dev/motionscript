import { Video } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Video} playing a trimmed window (`trimStart`/`trimEnd`) of the source clip at normal speed, muted so the e2e harness stays deterministic. */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Video, {
            src: 'video.mp4',
            width: 480,
            height: 270,
            fit: 'fill',
            trimStart: 0.5,
            trimEnd: 2.5,
            muted: true,
        }),
    );
}, [
    1.8,
    holdTail(1.8),
]);
