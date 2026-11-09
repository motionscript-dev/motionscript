import { beforeAll, describe, expect, it } from 'vitest';
import { Registry, Rect, type Command } from '@motionscript/sdk';
import { Code, listingOf } from '../node';
import { NODES } from '../nodes';
import { ensureHighlighter } from '../highlight';
import { Frame, at, attach, inFlight, make, render, sourceOf, tokensOf } from './harness.fixtures';

/**
 * The node's own behaviour: what it does when a prop is set, what it refuses to
 * hold, and the outline it declares.
 */

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript', 'python']);
});

/** The structure the listing shows: each line's id and its tokens' ids and colours. */
function structure(node: Code) {
    return listingOf(node).lines;
}

const ids = (node: Code) => structure(node).map((line) => [line.id, ...line.tokens.map((t) => t.id)]);
const colours = (node: Code) => structure(node).map((line) => line.tokens.map((t) => t.color));

describe('set() re-tokenizing', () => {
    it('tokenizes the source it is built with, at once', () => {
        expect(tokensOf(make('const a = 1;'))).toEqual([['const', ' ', 'a', ' ', '=', ' ', '1', ';']]);
    });

    it('re-tokenizes the new source after set({ code })', () => {
        const node = make('const a = 1;');
        node.set({ code: 'let b;' } as never);
        render(node);
        expect(tokensOf(node)).toEqual([['let', ' ', 'b', ';']]);
        expect(sourceOf(node)).toBe('let b;');
    });

    it('re-tokenizes with the new theme after set({ theme }), same tokens in new colours', () => {
        const node = make('const a = 1;');
        render(node);
        const before = colours(node);
        node.set({ theme: 'github-dark' } as never);
        render(node);
        expect(tokensOf(node)).toEqual([['const', ' ', 'a', ' ', '=', ' ', '1', ';']]);
        expect(colours(node)).not.toEqual(before);
        expect(colours(node)[0][0]).toBe('#ff7b72');
    });

    it('re-tokenizes with the new grammar after set({ language })', () => {
        const node = make('x = 1');
        render(node);
        expect(tokensOf(node)[0].length).toBeGreaterThan(1);
        node.set({ language: 'klingon' } as never);
        render(node);
        expect(tokensOf(node)).toEqual([['x = 1']]);
    });

    it('draws what it re-tokenized', () => {
        const node = make('const a = 1;');
        node.set({ code: 'x' } as never);
        expect(render(node).tokens.map((t) => t.text)).toEqual(['x']);
    });

    it('reads a bound code: a binding that changes is a new listing', () => {
        let source = 'a = 1';
        const node = make('');
        node.set({ code: () => source } as never);
        render(node);
        expect(sourceOf(node)).toBe('a = 1');
        source = 'b = 2\nc = 3';
        render(node);
        expect(sourceOf(node)).toBe('b = 2\nc = 3');
        expect(tokensOf(node)).toHaveLength(2);
    });

    it('keeps the ids of a listing it derives again from the same source', () => {
        const node = make('const a = 1;');
        render(node);
        const first = ids(node);
        render(node);
        expect(ids(node)).toEqual(first);
        // And goes back to a source it showed before with the ids it had then.
        node.set({ code: 'other' } as never);
        render(node);
        node.set({ code: 'const a = 1;' } as never);
        render(node);
        expect(ids(node)).toEqual(first);
    });

    it('normalises a source with CRLF line breaks to the lines they break', () => {
        const node = make('a\r\nb');
        expect(tokensOf(node)).toEqual([['a'], ['b']]);
        expect(sourceOf(node)).toBe('a\nb');
    });
});

describe('set() while an edit is in flight', () => {
    function mid(): { node: Code; edit: Command<unknown> } {
        const node = make('a = 1;');
        render(node);
        const edit = node.append({ data: { code: '\nb = 2;' }, duration: 1 }) as Command<unknown>;
        at(edit, 0.5);
        render(node);
        return { node, edit };
    }

    it('leaves the structure the edit captured alone: no fresh ids under a transition keyed by the old ones', () => {
        const { node } = mid();
        const before = ids(node);
        node.set({ theme: 'github-dark' } as never);
        render(node);
        expect(ids(node)).toEqual(before);
        expect(tokensOf(node)).toEqual([['a', ' ', '=', ' ', '1', ';'], ['b', ' ', '=', ' ', '2', ';']]);
    });

    it('keeps the colours it had while the edit runs', () => {
        const { node } = mid();
        const before = colours(node);
        node.set({ theme: 'github-dark' } as never);
        render(node);
        expect(colours(node)).toEqual(before);
    });

    it('picks the change up once the edit has settled', () => {
        const { node, edit } = mid();
        node.set({ theme: 'github-dark' } as never);
        at(edit, 1);
        render(node);
        expect(tokensOf(node)).toEqual([['a', ' ', '=', ' ', '1', ';'], ['b', ' ', '=', ' ', '2', ';']]);
        expect(colours(node)[0][0]).toBe('#79c0ff');
    });

    it('has an edit in flight at the middle of an edit, and none before or after', () => {
        const { node, edit } = mid();
        expect(inFlight(node)).toBe(true);
        at(edit, 0);
        expect(inFlight(node)).toBe(false);
        at(edit, 1);
        expect(inFlight(node)).toBe(false);
    });
});

describe('what a listing holds', () => {
    it('refuses a child: a listing holds a listing', () => {
        const node = make();
        expect(() => node.add(new Rect({ width: 10, height: 10 } as never))).toThrow();
        expect(node.children).toHaveLength(0);
    });

    it('refuses a child built into it', () => {
        expect(() => new Code({ code: 'a', children: [new Rect({ width: 10, height: 10 } as never)] } as never)).toThrow();
    });

    it('refuses a listing as a child of a listing', () => {
        expect(() => make().add(new Code({ code: 'b' }))).toThrow();
    });

    it('is declared as a node that takes no children, for a host that lists what a node accepts', () => {
        const accepts = (node: Code) => (node as unknown as { acceptsChild(child: unknown): boolean }).acceptsChild(new Rect({} as never));
        expect(accepts(make())).toBe(false);
    });
});

describe('the outline a listing declares', () => {
    type Op = { kind: string; state: Record<string, number> };
    const clipOf = (node: Code) => (node as unknown as { clipSelf(): { ops(): Op[] } }).clipSelf();
    const rects = (node: Code) => clipOf(node).ops().filter((op) => op.kind === 'rect').map((op) => op.state);

    // What picking and backdrop effects read: the text, line by ragged line, rather than the box around it.
    it('is a slot per line, as wide as the line\'s ink, inside the laid-out box', () => {
        const node = make('ab\n\nabcdefghij', { letterSpacing: 0 } as never);
        render(node, { width: 300, height: 120 });
        const lines = rects(node);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({ width: 16, height: 25.6 });
        expect(lines[0].y).toBeCloseTo(25.6);
        expect(lines[1]).toMatchObject({ width: 80, height: 25.6 });
        for (const line of lines) {
            expect(Math.abs(line.x) + line.width / 2).toBeLessThanOrEqual(150);
            expect(Math.abs(line.y) + line.height / 2).toBeLessThanOrEqual(60);
        }
    });

    it('is cut to the box when the box is narrower than a line', () => {
        const node = make('abcdefghij', { letterSpacing: 0, width: 40 } as never);
        render(node, { width: 40, height: 120 });
        expect(rects(node)).toEqual([expect.objectContaining({ x: 0, width: 40 })]);
    });

    it('is the box a hugging listing of one line measures to, once it is laid out at that size', () => {
        const node = attach(make('abcd', { letterSpacing: 0 } as never));
        const { width, height } = node.measure({} as never, new Frame());
        node.layout({ x: 0, y: 0, width: width ?? 0, height: height ?? 0 }, new Frame());
        expect(rects(node)).toEqual([expect.objectContaining({ x: 0, y: 0, width: 32, height: 25.6 })]);
    });

    it('is the box while an edit is in flight, and before the listing has been measured', () => {
        const node = make('ab');
        render(node, { width: 300, height: 120 });
        const edit = node.append({ data: { code: '\ncd' }, duration: 1 }) as Command<unknown>;
        at(edit, 0.5);
        expect(rects(node)).toEqual([expect.objectContaining({ x: 0, y: 0, width: 300, height: 120 })]);
        const fresh = make('ab');
        fresh.layout({ x: 0, y: 0, width: 200, height: 50 }, new Frame());
        expect(rects(fresh)).toEqual([expect.objectContaining({ width: 200, height: 50 })]);
    });

    it('has nothing to grab for a listing with no ink', () => {
        const node = make('\n');
        render(node, { width: 300, height: 120 });
        expect(clipOf(node).ops().map((op) => op.kind)).toEqual(['rect', 'rect', 'cut']);
        expect((node as unknown as { _hitTestSelf(p: { x: number; y: number }, t: number): boolean })._hitTestSelf({ x: 0, y: 0 }, 0)).toBe(false);
    });
});

describe('the commands a listing publishes', () => {
    const registry = new Registry({ nodes: NODES });

    it('are the edits and the highlight, besides the commands every node has', () => {
        expect(registry.commandKeys('code')).toEqual(
            expect.arrayContaining(['append', 'prepend', 'insert', 'remove', 'replace', 'highlight', 'resetHighlight', 'fadeTo', 'moveTo']),
        );
    });

    it('publishes the erase as remove, through a method of its own: the node\'s `remove` takes a child out', () => {
        expect(registry.commandKeys('code')).not.toContain('erase');
        expect(registry.node('code')?.commands.get('remove')?.method).toBe('_command_remove');
    });

    it('describes what each edit takes', () => {
        const commands = registry.node('code')!.commands;
        expect(commands.get('append')?.args.map((arg) => arg.key)).toEqual(['code']);
        expect(commands.get('insert')?.args.map((arg) => arg.key)).toEqual(['position', 'code']);
        expect(commands.get('remove')?.args.map((arg) => arg.key)).toEqual(['target']);
        expect(commands.get('replace')?.args.map((arg) => arg.key)).toEqual(['target', 'replacement']);
        expect(commands.get('highlight')?.args.map((arg) => arg.key)).toEqual(['target', 'dim']);
        expect(commands.get('resetHighlight')?.args).toEqual([]);
    });
});
