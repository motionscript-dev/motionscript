import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { Code } from '@motionscript/code';
import { holdTail } from './_lib';

/** {@link Code.insert}: a parameter is typed into the middle of an existing line, not just appended. */
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
                    code: 'function greet() {\n  return "hi";\n}',
                }),
            ] }),
        ] }),
    );
}, [
    0.5,
    () => code().insert({ data: { position: [1, 15], code: 'name: string' }, duration: 0.7 }),
    holdTail(1.2),
]);
