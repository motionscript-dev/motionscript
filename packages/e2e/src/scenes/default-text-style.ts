import { DefaultTextStyle, Rect, Text } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link DefaultTextStyle} setting `fontFamily`/`fill` for every {@link Text} beneath it — descendants that don't set their own font inherit it, while one that overrides `fontFamily` locally keeps its own. */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(DefaultTextStyle, { fontFamily: 'Inter', fontWeight: 700, fill: '#f4f6ff', children: [
            el(Rect, { width: 'fill', height: 'fill', flow: 'vertical', gap: 20, align: { x: 0, y: 0 }, children: [
                el(Text, { text: 'Inherits Inter', fontSize: 42 }),
                el(Text, { text: 'Also inherits Inter', fontSize: 42 }),
                el(Text, { text: 'Overrides to Fira Mono', fontFamily: 'Fira Mono', fontSize: 42 }),
            ] }),
        ] }),
    );
}, [
    1.2,
    holdTail(1.2),
]);
