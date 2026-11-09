import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { Code } from '@motionscript/code';
import { holdTail } from './_lib';

/** {@link Code.prepend}: an import line is typed in above the existing snippet, pushing it down. */
const code = createRef<Code>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { cornerRadius: 16, fill: '#0f121a', height: 'hug', width: 'hug', clip: true, children: [
                el(Code, {
                    ref: code,
                    theme: 'vscode-dark',
                    language: 'typescript',
                    padding: { horizontal: 48, vertical: 36 },
                    fontSize: 18,
                    code: `export function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}`,
                }),
            ] }),
        ] }),
    );
}, [
    0.5,
    () => code().prepend({ data: { code: 'import { clamp as builtin } from "./math";\n\n' }, duration: 0.8 }),
    holdTail(1.3),
]);
