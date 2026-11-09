import { describe, it, expect, beforeAll } from 'vitest';
import { tags } from '@lezer/highlight';
import { ContextMap, type Command, type Node } from '@motionscript/sdk';
import { ManifestAssetCatalog } from '@motionscript/core';
import { Code } from '../node';
import { CodeRanges } from '../code-range';
import { ensureHighlighter } from '../highlight';
import { compileStyle, type CodeHighlightStyle } from '../style';

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript']);
});

function styled(color: string, name = 'same-name'): CodeHighlightStyle {
    return { name, defaultColor: '#000000', rules: [{ tag: tags.keyword, color }] };
}

describe('compileStyle', () => {
    it('colours with the style it was given, not the first one compiled under its name', () => {
        const red = styled('#ff0000');
        const blue = styled('#0000ff');
        expect(compileStyle(red).style([tags.keyword])).toBe('#ff0000');
        expect(compileStyle(blue).style([tags.keyword])).toBe('#0000ff');
    });

    it('reuses the compiled highlighter for the same style object', () => {
        const style = styled('#00ff00', 'reused');
        expect(compileStyle(style)).toBe(compileStyle(style));
    });
});

describe('a code range chain through JSON', () => {
    const SOURCE = 'function add(a, b) {\n  return a + b;\n}';

    function highlighted(range: unknown): number {
        const node = new Code({ code: SOURCE, language: 'typescript' });
        node.attach({
            assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
            context: ContextMap.EMPTY,
            time: 0,
        } as Parameters<Node['attach']>[0]);
        const command = node.highlight({ data: { target: range as never }, duration: 1 }) as Command<unknown>;
        const step = command._stepper();
        step.seek(0);
        step.advance(1);
        return node.focus.ids.size;
    }

    it('serialises as its ranges, so a stored document reads back as the same selection', () => {
        const chain = CodeRanges.lines(2).word(1, 10, 3);
        const restored = JSON.parse(JSON.stringify(chain));
        expect(Array.isArray(restored)).toBe(true);
        expect(highlighted(restored)).toBe(highlighted(chain));
        expect(highlighted(chain)).toBeGreaterThan(0);
    });

    it('still reads the { list } shape an earlier document stored', () => {
        const chain = CodeRanges.lines(2);
        const legacy = JSON.parse(JSON.stringify({ list: chain.list }));
        expect(highlighted(legacy)).toBe(highlighted(chain));
    });
});
