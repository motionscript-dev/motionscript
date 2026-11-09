import { describe, expect, it } from 'vitest';

import { diffClip } from '@/document/diff';
import { indexDocument } from '@/document/doc-index';
import type { TimelinePatch } from '@/document/timeline-patch';
import { ROOT_NODE_ID, type ClipDocument } from '@/document/types';
import { Rect } from "@/components/builtins/geometry/geometry";
import { LAYOUT_SLOT, PRESENCE_PREFIX, STRUCTURE_SLOT, VAR_PREFIX } from '@/props/observer';
import { PropSlot } from '@/props/slot';
import type { ClipInstance } from '@/runtime/clip-instance';
import {
    dirtyOwners, firstFrameAt, hostlessSlotId, hostSlotId, OwnerDependencies, SlotNamer,
    type DirtyInput, type PlacedWrites, type SlotId,
} from '@/runtime/asset-update';
import { comp, node } from '@/runtime/document.fixtures';

const FPS = 10;

// ─── SlotNamer ────────────────────────────────────────────────────────────────

describe('SlotNamer', () => {
    /** An instance that knows only the owner keys it is told about. */
    function instanceOf(known: Map<object, string>) {
        const calls: object[] = [];
        const instance = {
            ownerKeyOf: (host: object) => { calls.push(host); return known.get(host); },
        } as unknown as ClipInstance;
        return { instance, calls };
    }

    it('names a slot after the owner key of the node holding it and the prop', () => {
        const host = new Rect({});
        const { instance } = instanceOf(new Map([[host, 'card']]));
        const namer = new SlotNamer(instance);

        const id = namer.idOf(new PropSlot(0, host, 'src'));
        expect(id).toBe(hostSlotId('card', 'src'));
    });

    it('names a slot of a node a composite built by its path below the row', () => {
        const host = new Rect({});
        const { instance } = instanceOf(new Map([[host, 'row/0.1']]));
        expect(new SlotNamer(instance).idOf(new PropSlot(0, host, 'width'))).toBe(hostSlotId('row/0.1', 'width'));
    });

    it('names a slot with no host by its name alone, apart from any hosted one', () => {
        const { instance } = instanceOf(new Map());
        const id = new SlotNamer(instance).idOf(new PropSlot(0, null, 'var:g'));
        expect(id).toBe(hostlessSlotId('var:g'));
        expect(id).not.toBe(hostSlotId('', 'var:g'));
    });

    it('gives a node no row built, a detached surface source say, an id of its own kind', () => {
        const detached = new Rect({});
        const { instance } = instanceOf(new Map());
        const id = new SlotNamer(instance).idOf(new PropSlot(0, detached, 'src'));

        expect(id).not.toBe(hostSlotId('', 'src'));
        expect(id).not.toBe(hostlessSlotId('src'));
        // Two detached nodes' same-named slots share an id: the name is all it keeps.
        const other = new Rect({});
        expect(new SlotNamer(instance).idOf(new PropSlot(0, other, 'src'))).toBe(id);
    });

    it('treats a host that is not a Node as detached without asking the instance', () => {
        const { instance, calls } = instanceOf(new Map());
        const id = new SlotNamer(instance).idOf(new PropSlot(0, { id: 'plain' }, 'x'));
        expect(calls).toEqual([]);
        expect(id).not.toBe(hostlessSlotId('x'));
    });

    it('asks the instance once per host, however many slots the host has', () => {
        const host = new Rect({});
        const { instance, calls } = instanceOf(new Map([[host, 'card']]));
        const namer = new SlotNamer(instance);

        namer.idOf(new PropSlot(0, host, 'a'));
        namer.idOf(new PropSlot(0, host, 'b'));
        namer.idOf(new PropSlot(0, host, 'a'));

        expect(calls).toEqual([host]);
    });

    it('idsOf names a batch in order', () => {
        const host = new Rect({});
        const { instance } = instanceOf(new Map([[host, 'card']]));
        const slots = [new PropSlot(0, host, 'a'), new PropSlot(0, null, 'var:g')];
        expect(new SlotNamer(instance).idsOf(slots)).toEqual([hostSlotId('card', 'a'), hostlessSlotId('var:g')]);
        expect(new SlotNamer(instance).idsOf([])).toEqual([]);
    });
});

// ─── OwnerDependencies ────────────────────────────────────────────────────────

describe('OwnerDependencies', () => {
    const a = hostSlotId('card', 'src');
    const b = hostSlotId('card', 'width');
    const v = hostlessSlotId(`${VAR_PREFIX}g`);

    it('records what an owner read and who reads each slot', () => {
        const deps = new OwnerDependencies();
        deps.set('card', [a, v]);
        deps.set('other', [a]);

        expect(deps.has('card')).toBe(true);
        expect([...deps.depsOf('card')].sort()).toEqual([a, v].sort());
        expect([...deps.readersOf(a)].sort()).toEqual(['card', 'other']);
        expect([...deps.readersOf(v)]).toEqual(['card']);
        expect(deps.has('nobody')).toBe(false);
        expect(deps.depsOf('nobody').size).toBe(0);
        expect(deps.readersOf(b).size).toBe(0);
    });

    it('replaces an owner\'s previous reads rather than adding to them', () => {
        const deps = new OwnerDependencies();
        deps.set('card', [a, v]);
        deps.set('card', [b]);

        expect([...deps.depsOf('card')]).toEqual([b]);
        expect(deps.readersOf(a).size).toBe(0);
        expect(deps.readersOf(v).size).toBe(0);
        expect([...deps.readersOf(b)]).toEqual(['card']);
        expect(deps.slotsNamed('src').size).toBe(0);
    });

    it('forgets everything about an owner on remove, and a second remove is harmless', () => {
        const deps = new OwnerDependencies();
        deps.set('card', [a]);
        deps.set('other', [a]);
        deps.remove('card');

        expect(deps.has('card')).toBe(false);
        expect([...deps.readersOf(a)]).toEqual(['other']);
        expect(() => deps.remove('card')).not.toThrow();

        deps.remove('other');
        expect(deps.readersOf(a).size).toBe(0);
        expect(deps.slotsHostedBy('card').size).toBe(0);
        expect(deps.slotsNamed('src').size).toBe(0);
    });

    it('indexes the slots a node holds by host', () => {
        const deps = new OwnerDependencies();
        deps.set('x', [a, b, hostSlotId('other', 'src')]);

        expect([...deps.slotsHostedBy('card')].sort()).toEqual([a, b].sort());
        expect([...deps.slotsHostedBy('other')]).toEqual([hostSlotId('other', 'src')]);
        expect(deps.slotsHostedBy('nobody').size).toBe(0);
    });

    it('keeps a slot indexed while any owner still reads it', () => {
        const deps = new OwnerDependencies();
        deps.set('one', [a]);
        deps.set('two', [a]);
        deps.remove('one');
        expect([...deps.slotsHostedBy('card')]).toEqual([a]);
        deps.remove('two');
        expect(deps.slotsHostedBy('card').size).toBe(0);
    });

    it('indexes slots by name across hosts, hostless ones included', () => {
        const deps = new OwnerDependencies();
        deps.set('x', [hostSlotId('card', 'src'), hostSlotId('other', 'src'), hostlessSlotId('src'), hostSlotId('card', 'width')]);

        expect([...deps.slotsNamed('src')].sort()).toEqual([
            hostSlotId('card', 'src'), hostSlotId('other', 'src'), hostlessSlotId('src'),
        ].sort());
        expect(deps.slotsNamed('width').size).toBe(1);
        expect(deps.slotsNamed(LAYOUT_SLOT).size).toBe(0);
    });

    describe('owners built below a row', () => {
        it('lists every owner whose key is under the row, however deep', () => {
            const deps = new OwnerDependencies();
            deps.set('row', [a]);
            deps.set('row/0', [a]);
            deps.set('row/0.1', [a]);
            deps.set('other/0', [a]);

            expect([...deps.ownersBelow('row')].sort()).toEqual(['row/0', 'row/0.1']);
            expect([...deps.ownersBelow('other')]).toEqual(['other/0']);
            // An owner is never below itself.
            expect(deps.ownersBelow('row/0').has('row/0')).toBe(false);
        });

        it('lets a row id hold a slash of its own: every prefix at a slash counts as a row', () => {
            const deps = new OwnerDependencies();
            deps.set('a/b/0', [a]);
            expect([...deps.ownersBelow('a')]).toEqual(['a/b/0']);
            expect([...deps.ownersBelow('a/b')]).toEqual(['a/b/0']);
        });

        it('forgets an owner from every row above it on remove', () => {
            const deps = new OwnerDependencies();
            deps.set('row/0.1', [a]);
            deps.remove('row/0.1');
            expect(deps.ownersBelow('row').size).toBe(0);
        });

        it('yields the slots hosted by anything below a row', () => {
            const deps = new OwnerDependencies();
            deps.set('row/0', [hostSlotId('row/0', 'src')]);
            deps.set('row/1.2', [hostSlotId('row/1.2', 'width'), hostSlotId('elsewhere', 'src')]);

            expect([...deps.slotsHostedBelow('row')].sort()).toEqual([
                hostSlotId('row/0', 'src'), hostSlotId('row/1.2', 'width'),
            ].sort());
            expect([...deps.slotsHostedBelow('elsewhere')]).toEqual([]);
            expect([...deps.slotsHostedBelow('nobody')]).toEqual([]);
        });

        it('does not count a hostless or detached slot as hosted below anything', () => {
            const deps = new OwnerDependencies();
            deps.set('row/0', [hostlessSlotId('var:g')]);
            expect([...deps.slotsHostedBelow('row')]).toEqual([]);
        });
    });
});

// ─── firstFrameAt ─────────────────────────────────────────────────────────────

describe('firstFrameAt', () => {
    /** The definition: the first frame whose time (`frame * (1 / fps)`) reaches `seconds`. */
    const oracle = (seconds: number, fps: number): number => {
        let frame = 0;
        while (frame * (1 / fps) < seconds) frame++;
        return frame;
    };

    it('is 0 for time zero, a negative time and a time that is not a number', () => {
        expect(firstFrameAt(0, 10)).toBe(0);
        expect(firstFrameAt(-1, 10)).toBe(0);
        expect(firstFrameAt(-0, 10)).toBe(0);
        expect(firstFrameAt(NaN, 10)).toBe(0);
    });

    it('is Infinity for an unbounded time', () => {
        expect(firstFrameAt(Infinity, 10)).toBe(Infinity);
    });

    it('is the frame itself for a time exactly on a frame', () => {
        expect(firstFrameAt(1, 10)).toBe(10);
        expect(firstFrameAt(2.5, 10)).toBe(25);
        expect(firstFrameAt(1, 30)).toBe(30);
    });

    it('rounds a time between two frames up to the later one', () => {
        expect(firstFrameAt(0.05, 10)).toBe(1);
        expect(firstFrameAt(0.31, 10)).toBe(4);
        expect(firstFrameAt(1 / 3 + 1e-6, 30)).toBe(11);
    });

    it('lands on the frame a float product puts a hair either side of it', () => {
        // 3 * (1 / 10) is 0.30000000000000004, so time 0.3 is reached on frame 3 and
        // the slightly larger 0.1 + 0.2 is reached there too, not on frame 4.
        expect(firstFrameAt(0.3, 10)).toBe(3);
        expect(firstFrameAt(0.1 + 0.2, 10)).toBe(3);
        expect(firstFrameAt(1 / 3, 30)).toBe(10);
    });

    it('agrees with the definition around every boundary of several frame rates', () => {
        for (const fps of [10, 24, 25, 30, 48, 60]) {
            for (let frame = 0; frame <= 200; frame++) {
                const exact = frame * (1 / fps);
                for (const seconds of [exact, exact - 1e-12, exact + 1e-12, exact + 0.4 / fps]) {
                    expect(firstFrameAt(seconds, fps), `fps ${fps}, ${seconds}`).toBe(oracle(seconds, fps));
                }
            }
        }
    });

    it('is a frame at or past the time, and the one before is short of it', () => {
        for (const seconds of [0.123, 0.5, 1.7, 3.333, 12.0001]) {
            const frame = firstFrameAt(seconds, 24);
            expect(frame * (1 / 24)).toBeGreaterThanOrEqual(seconds);
            if (frame > 0) expect((frame - 1) * (1 / 24)).toBeLessThan(seconds);
        }
    });
});

// ─── dirtyOwners ──────────────────────────────────────────────────────────────

/** A patch between two documents with the fields `dirtyOwners` reads filled in. */
function patchOf(prevDoc: ClipDocument, nextDoc: ClipDocument, over: Partial<TimelinePatch> = {}): TimelinePatch {
    const diff = diffClip(prevDoc, nextDoc);
    return {
        prev: indexDocument(prevDoc),
        next: indexDocument(nextDoc),
        diff,
        added: diff.nodes.added,
        removed: diff.nodes.removed,
        reinstantiate: new Set([...diff.nodes.respec, ...diff.nodes.moved]),
        inPlace: new Set(),
        detach: new Set(),
        dirtyNodes: new Set(),
        dirtyVariables: new Set(),
        replay: new Set(),
        captures: [],
        layoutChanged: false,
        ...over,
    };
}

function inputOf(patch: TimelinePatch, deps: OwnerDependencies, over: Partial<DirtyInput> = {}): DirtyInput {
    return {
        patch,
        deps,
        before: new Map(),
        after: new Map(),
        fps: FPS,
        propsOf: () => undefined,
        buildsChildren: () => false,
        isContextProvider: () => false,
        ...over,
    };
}

const rect = (id: string, props: Record<string, unknown> = {}, parentId: string | null = null, layerOrder = 0) =>
    node(id, 'rect', props, parentId, layerOrder);
const spanned = (id: string, span: { startAt?: number; endAt?: number }, props: Record<string, unknown> = {}) =>
    ({ ...rect(id, props), ...span });

/** Dependencies where each owner reads the slots named. */
function depsOf(reads: Record<string, SlotId[]>): OwnerDependencies {
    const deps = new OwnerDependencies();
    for (const [owner, slots] of Object.entries(reads)) deps.set(owner, slots);
    return deps;
}

describe('dirtyOwners', () => {
    const same = comp([rect('card')], [], 4);

    describe('placed commands', () => {
        const slot = hostSlotId('card', 'src');
        const placed = (start: number): PlacedWrites => ({ start, writes: [slot] });

        it('names the readers of a command that was only in the patch before it, from where it started', () => {
            const key = {};
            const result = dirtyOwners(inputOf(
                patchOf(same, same), depsOf({ pic: [slot], other: [hostSlotId('card', 'width')] }),
                { before: new Map([[key, placed(1)]]) },
            ));

            expect(result.owners).toEqual(new Map([['pic', 10]]));
            // A command's own edit is not an arrival: the owner's audio is left alone.
            expect(result.arrivalOwners.size).toBe(0);
        });

        it('names the readers of a command that is only there after the patch', () => {
            const key = {};
            const result = dirtyOwners(inputOf(
                patchOf(same, same), depsOf({ pic: [slot] }),
                { after: new Map([[key, placed(0.35)]]) },
            ));
            // Start 0.35 at 10 fps is reached on frame 4.
            expect(result.owners).toEqual(new Map([['pic', 4]]));
        });

        it('ignores a command on both sides: the patch did not rebuild it', () => {
            const key = {};
            const result = dirtyOwners(inputOf(
                patchOf(same, same), depsOf({ pic: [slot] }),
                { before: new Map([[key, placed(1)]]), after: new Map([[key, placed(1)]]) },
            ));
            expect(result.owners.size).toBe(0);
        });

        it('takes the earliest frame when several commands name one owner', () => {
            const result = dirtyOwners(inputOf(
                patchOf(same, same), depsOf({ pic: [slot] }),
                { before: new Map([[{}, placed(3)]]), after: new Map([[{}, placed(1)], [{}, placed(2)]]) },
            ));
            expect(result.owners.get('pic')).toBe(10);
        });

        it('names every reader of every slot a command wrote', () => {
            const other = hostSlotId('card', 'fill');
            const result = dirtyOwners(inputOf(
                patchOf(same, same), depsOf({ a: [slot], b: [other], c: [hostSlotId('card', 'x')] }),
                { before: new Map([[{}, { start: 2, writes: [slot, other] }]]) },
            ));
            expect([...result.owners.keys()].sort()).toEqual(['a', 'b']);
        });
    });

    describe('variables, layout and ordering', () => {
        const varSlot = hostlessSlotId(`${VAR_PREFIX}g`);

        it('names the readers of a variable whose value or lerp changed, from the first frame, as arrivals', () => {
            const withVar = (value: number) => ({ ...comp([rect('card')], [], 4), variables: [{ id: 'g', value }] });
            const result = dirtyOwners(inputOf(
                patchOf(withVar(0), withVar(5)), depsOf({ reader: [varSlot], other: [hostlessSlotId(`${VAR_PREFIX}h`)] }),
            ));
            expect(result.owners).toEqual(new Map([['reader', 0]]));
            expect(result.arrivalOwners).toEqual(new Set(['reader']));
        });

        it('leaves a variable alone when only its name changed', () => {
            const named = (name: string) => ({ ...comp([rect('card')], [], 4), variables: [{ id: 'g', value: 1, name }] });
            const result = dirtyOwners(inputOf(patchOf(named('a'), named('b')), depsOf({ reader: [varSlot] })));
            expect(result.owners.size).toBe(0);
        });

        it('names every reader of a layout slot when layout changed, and nobody when it did not', () => {
            const deps = depsOf({
                a: [hostSlotId('card', LAYOUT_SLOT)], b: [hostSlotId('other', LAYOUT_SLOT)], c: [hostSlotId('card', 'src')],
            });
            const changed = dirtyOwners(inputOf(patchOf(same, same, { layoutChanged: true }), deps));
            expect([...changed.owners.entries()].sort()).toEqual([['a', 0], ['b', 0]]);
            expect(changed.arrivalOwners).toEqual(new Set(['a', 'b']));

            expect(dirtyOwners(inputOf(patchOf(same, same), deps)).owners.size).toBe(0);
        });

        it('names the readers of a parent\'s structure when its children were reordered', () => {
            const order = (first: string, second: string) => comp([
                rect('row'),
                rect(first, {}, 'row', 0),
                rect(second, {}, 'row', 1),
            ], [], 4);
            const deps = depsOf({
                reader: [hostSlotId('row', STRUCTURE_SLOT)],
                unrelated: [hostSlotId('elsewhere', STRUCTURE_SLOT)],
            });
            const result = dirtyOwners(inputOf(patchOf(order('a', 'b'), order('b', 'a')), deps));
            expect(result.owners).toEqual(new Map([['reader', 0]]));
        });

        it('names the readers of the root\'s structure when top-level rows were reordered', () => {
            const order = (first: string, second: string) => comp([rect(first, {}, null, 0), rect(second, {}, null, 1)], [], 4);
            const deps = depsOf({ reader: [hostSlotId(ROOT_NODE_ID, STRUCTURE_SLOT)] });
            const result = dirtyOwners(inputOf(patchOf(order('a', 'b'), order('b', 'a')), deps));
            expect(result.owners).toEqual(new Map([['reader', 0]]));
        });
    });

    describe('removed rows', () => {
        const prev = comp([spanned('card', { startAt: 1, endAt: 3 }), rect('other')], [], 5);
        const next = comp([rect('other')], [], 5);

        it('lists the row as removed and names everything hosted on it from its first frame', () => {
            const deps = depsOf({
                card: [hostSlotId('card', 'src')],
                viewer: [hostSlotId('card', 'width')],
                unrelated: [hostSlotId('other', 'src')],
            });
            const result = dirtyOwners(inputOf(patchOf(prev, next), deps));

            expect(result.removed).toEqual(new Set(['card']));
            expect(result.owners).toEqual(new Map([['card', 10], ['viewer', 10]]));
            expect(result.arrivalOwners).toEqual(new Set(['card', 'viewer']));
        });

        it('names the readers of its presence and of the structure it sat in', () => {
            const deps = depsOf({
                watcher: [hostlessSlotId(`${PRESENCE_PREFIX}card`)],
                parent: [hostSlotId(ROOT_NODE_ID, STRUCTURE_SLOT)],
                ownStructure: [hostSlotId('card', STRUCTURE_SLOT)],
            });
            const result = dirtyOwners(inputOf(patchOf(prev, next), deps));
            expect([...result.owners.entries()].sort()).toEqual([
                ['ownStructure', 10], ['parent', 10], ['watcher', 10],
            ]);
        });

        it('names the slots hosted by anything a composite built below the row', () => {
            const deps = depsOf({ inner: [hostSlotId('card/0', 'src')] });
            const result = dirtyOwners(inputOf(patchOf(prev, next), deps));
            expect(result.owners).toEqual(new Map([['inner', 10]]));
        });
    });

    describe('added rows', () => {
        const prev = comp([rect('other')], [], 5);
        const next = comp([rect('other'), spanned('card', { startAt: 2, endAt: 4 })], [], 5);

        it('declares the new owner from the frame it first mounts', () => {
            const result = dirtyOwners(inputOf(patchOf(prev, next), new OwnerDependencies()));
            expect(result.owners).toEqual(new Map([['card', 20]]));
            expect(result.arrivalOwners).toEqual(new Set(['card']));
        });

        it('names the readers of its presence and of the structure it joined', () => {
            const deps = depsOf({
                watcher: [hostlessSlotId(`${PRESENCE_PREFIX}card`)],
                parent: [hostSlotId(ROOT_NODE_ID, STRUCTURE_SLOT)],
            });
            const result = dirtyOwners(inputOf(patchOf(prev, next), deps));
            expect(result.owners.get('watcher')).toBe(20);
            expect(result.owners.get('parent')).toBe(20);
        });

        it('skips a row whose first frame is unreachable: it starts at a time that is not finite', () => {
            const never = comp([rect('other'), spanned('ghost', { startAt: Infinity })], [], 5);
            const result = dirtyOwners(inputOf(patchOf(prev, never), new OwnerDependencies()));
            expect(result.owners.has('ghost')).toBe(false);
            expect(result.below.has('ghost')).toBe(false);
            expect(result.arrivalOwners.has('ghost')).toBe(false);
        });

        it('still names a row whose span is empty, from the frame its start falls on', () => {
            const empty = comp([rect('other'), spanned('empty', { startAt: 3, endAt: 3 })], [], 5);
            const result = dirtyOwners(inputOf(patchOf(prev, empty), new OwnerDependencies()));
            expect(result.owners.get('empty')).toBe(30);
        });

        it('adds the rows below it only when it builds children or owners already sit below it', () => {
            const quiet = dirtyOwners(inputOf(patchOf(prev, next), new OwnerDependencies()));
            expect(quiet.below.size).toBe(0);

            const builds = dirtyOwners(inputOf(patchOf(prev, next), new OwnerDependencies(), { buildsChildren: (row) => row === 'card' }));
            expect(builds.below).toEqual(new Map([['card', 20]]));
            expect(builds.arrivalBelow).toEqual(new Set(['card']));

            const owned = dirtyOwners(inputOf(patchOf(prev, next), depsOf({ 'card/0': [hostSlotId('card/0', 'src')] })));
            expect(owned.below).toEqual(new Map([['card', 20]]));
        });
    });

    describe('spans that moved', () => {
        const withSpan = (span: { startAt?: number; endAt?: number }) => comp([spanned('card', span)], [], 6);

        it('declares the owner again from the earlier of the old and new start', () => {
            const later = dirtyOwners(inputOf(patchOf(withSpan({ startAt: 1, endAt: 4 }), withSpan({ startAt: 2, endAt: 4 })), new OwnerDependencies()));
            expect(later.owners).toEqual(new Map([['card', 10]]));

            const earlier = dirtyOwners(inputOf(patchOf(withSpan({ startAt: 2, endAt: 4 }), withSpan({ startAt: 1, endAt: 4 })), new OwnerDependencies()));
            expect(earlier.owners).toEqual(new Map([['card', 10]]));
        });

        it('names an owner whose end moved, from the row\'s start', () => {
            const result = dirtyOwners(inputOf(patchOf(withSpan({ startAt: 1, endAt: 4 }), withSpan({ startAt: 1, endAt: 5 })), new OwnerDependencies()));
            expect(result.owners).toEqual(new Map([['card', 10]]));
        });

        it('names nothing when the span is the same', () => {
            const result = dirtyOwners(inputOf(patchOf(withSpan({ startAt: 1, endAt: 4 }), withSpan({ startAt: 1, endAt: 4 })), new OwnerDependencies()));
            expect(result.owners.size).toBe(0);
        });

        it('falls back to the other side when the row was never mounted on one of them', () => {
            const result = dirtyOwners(inputOf(
                patchOf(withSpan({ startAt: 3, endAt: 3 }), withSpan({ startAt: 2, endAt: 4 })), new OwnerDependencies(),
            ));
            // Unmounted before, so only the new start counts.
            expect(result.owners).toEqual(new Map([['card', 20]]));
        });

        it('names the readers of the row\'s presence and structure as well', () => {
            const deps = depsOf({ watcher: [hostlessSlotId(`${PRESENCE_PREFIX}card`)] });
            const result = dirtyOwners(inputOf(patchOf(withSpan({ startAt: 1, endAt: 4 }), withSpan({ startAt: 2, endAt: 4 })), deps));
            expect(result.owners.get('watcher')).toBe(10);
        });
    });

    describe('re-instantiated rows', () => {
        const edit = (props: Record<string, unknown>) => comp([rect('card', props)], [], 4);
        const deps = () => depsOf({
            reader: [hostSlotId('card', 'src')],
            sizer: [hostSlotId('card', 'width')],
        });

        it('names only the readers of the props the edit changed, from frame 0, as arrivals', () => {
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png', width: 10 }), edit({ src: 'b.png', width: 10 })), deps(),
                { propsOf: () => new Set(['src', 'width']) },
            ));
            expect(result.owners).toEqual(new Map([['reader', 0]]));
            expect(result.arrivalOwners).toEqual(new Set(['reader']));
        });

        it('takes every hosted slot as changed when it cannot tell which props are slots', () => {
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png' }), edit({ src: 'b.png' })), deps(),
                { propsOf: () => undefined },
            ));
            expect([...result.owners.keys()].sort()).toEqual(['reader', 'sizer']);
        });

        it('takes every hosted slot as changed when an edited prop is not a slot of its own', () => {
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png' }), edit({ src: 'b.png' })), deps(),
                { propsOf: () => new Set(['width']) },
            ));
            expect([...result.owners.keys()].sort()).toEqual(['reader', 'sizer']);
        });

        it('always names a reader of the row\'s structure, whichever props changed', () => {
            const structure = hostSlotId('card', STRUCTURE_SLOT);
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png' }), edit({ src: 'b.png' })), depsOf({ walker: [structure], sizer: [hostSlotId('card', 'width')] }),
                { propsOf: () => new Set(['src', 'width']) },
            ));
            expect([...result.owners.keys()]).toEqual(['walker']);
        });

        it('takes every slot as changed for a new type, since the new node has none of the old', () => {
            const retyped = comp([node('card', 'ellipse', { src: 'a.png' })], [], 4);
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png' }), retyped), deps(),
                { propsOf: () => new Set(['src', 'width']) },
            ));
            expect([...result.owners.keys()].sort()).toEqual(['reader', 'sizer']);
        });

        it('takes every slot as changed for a moved row, and names the readers of the structure it left and joined', () => {
            const prev = comp([rect('p'), rect('q'), rect('card', { src: 'a.png' }, 'p')], [], 4);
            const next = comp([rect('p'), rect('q'), rect('card', { src: 'a.png' }, 'q')], [], 4);
            const result = dirtyOwners(inputOf(
                patchOf(prev, next),
                depsOf({
                    sizer: [hostSlotId('card', 'width')],
                    left: [hostSlotId('p', STRUCTURE_SLOT)],
                    joined: [hostSlotId('q', STRUCTURE_SLOT)],
                }),
                { propsOf: () => new Set(['src', 'width']) },
            ));
            expect([...result.owners.keys()].sort()).toEqual(['joined', 'left', 'sizer']);
        });

        it('takes every slot as changed when a context provider above was edited too', () => {
            const tree = (token: string) => comp([
                node('theme', 'theme-provider', { token }),
                rect('card', { src: 'a.png' }, 'theme'),
            ], [], 4);
            const changed = patchOf(tree('x'), tree('y'), { reinstantiate: new Set(['theme', 'card']) });
            const result = dirtyOwners(inputOf(changed, deps(), {
                propsOf: () => new Set(['src', 'width']),
                isContextProvider: (type) => type === 'theme-provider',
            }));
            // `card` itself changed nothing, but what it inherits did.
            expect([...result.owners.keys()].sort()).toEqual(['reader', 'sizer']);
        });

        it('names the owners below a row from frame 0 when the row builds children', () => {
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png' }), edit({ src: 'b.png' })), new OwnerDependencies(),
                { buildsChildren: (row) => row === 'card', propsOf: () => new Set(['src']) },
            ));
            expect(result.below).toEqual(new Map([['card', 0]]));
            expect(result.arrivalBelow).toEqual(new Set(['card']));
        });

        it('names an owner at or below the row that reads a detached slot, and no other', () => {
            const slot = new PropSlot(0, new Rect({}), 'src');
            const detached = new SlotNamer({ ownerKeyOf: () => undefined } as unknown as ClipInstance).idOf(slot);
            const result = dirtyOwners(inputOf(
                patchOf(edit({ src: 'a.png', other: 1 }), edit({ src: 'a.png', other: 2 })),
                depsOf({ card: [detached], 'card/0': [detached], viewer: [detached], unrelated: [hostSlotId('elsewhere', 'x')] }),
                { propsOf: () => new Set(['src']) },
            ));
            // A detached source belongs to no row, so a re-instantiated row names the owners
            // that are it or built below it; `viewer` reads one too but sits elsewhere.
            expect([...result.owners.keys()].sort()).toEqual(['card', 'card/0']);
            expect(result.owners.get('card')).toBe(0);
        });
    });

    describe('the root', () => {
        const rootWith = (props: Record<string, unknown>): ClipDocument => ({
            kind: 'composition', duration: 4, nodes: [{ id: ROOT_NODE_ID, type: 'canvas2d', parentId: null, layerOrder: 0, props }], commands: [],
        });

        it('names the readers of the root props that changed', () => {
            const deps = depsOf({
                bg: [hostSlotId(ROOT_NODE_ID, 'fill')],
                sizer: [hostSlotId(ROOT_NODE_ID, 'width')],
            });
            const result = dirtyOwners(inputOf(
                patchOf(rootWith({ fill: 'red', width: 100 }), rootWith({ fill: 'blue', width: 100 })), deps,
                { propsOf: (id) => (id === ROOT_NODE_ID ? new Set(['fill', 'width']) : undefined) },
            ));
            expect(result.owners).toEqual(new Map([['bg', 0]]));
        });

        it('takes every root slot as changed when the root\'s props are not known', () => {
            const deps = depsOf({ bg: [hostSlotId(ROOT_NODE_ID, 'fill')], sizer: [hostSlotId(ROOT_NODE_ID, 'width')] });
            const result = dirtyOwners(inputOf(
                patchOf(rootWith({ fill: 'red' }), rootWith({ fill: 'blue' })), deps,
            ));
            expect([...result.owners.keys()].sort()).toEqual(['bg', 'sizer']);
        });

        it('names nothing for the root when it did not change', () => {
            const deps = depsOf({ bg: [hostSlotId(ROOT_NODE_ID, 'fill')] });
            const result = dirtyOwners(inputOf(patchOf(rootWith({ fill: 'red' }), rootWith({ fill: 'red' })), deps));
            expect(result.owners.size).toBe(0);
        });
    });

    it('names nobody for an edit no declaration read', () => {
        const prev = comp([rect('card', { x: 0, width: 10 })], [], 4);
        const next = comp([rect('card', { x: 50, width: 10 })], [], 4);
        const result = dirtyOwners(inputOf(
            patchOf(prev, next), depsOf({ pic: [hostSlotId('card', 'src')] }),
            { propsOf: () => new Set(['x', 'width', 'src']) },
        ));
        expect(result.owners.size).toBe(0);
        expect(result.below.size).toBe(0);
        expect(result.removed.size).toBe(0);
    });
});
