import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { Code } from '@motionscript/code';
import { holdTail } from './_lib';

/** {@link Code.showLineNumbers}: a gutter of line numbers appears alongside the snippet. */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    const code = createRef<Code>();
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { cornerRadius: 16, fill: '#0f121a', height: 'hug', width: 'hug', clip: true, children: [
                el(Code, {
                    ref: code,
                    theme: 'vscode-dark',
                    language: 'typescript',
                    padding: { horizontal: 48, vertical: 36 },
                    fontSize: 18,
                    showLineNumbers: false,
                    code: `type Point = { x: number; y: number };

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}`,
                }),
            ] }),
        ] }),
    );
    code().set({ showLineNumbers: true });
}, [
    0.5,
    holdTail(0.5),
]);
