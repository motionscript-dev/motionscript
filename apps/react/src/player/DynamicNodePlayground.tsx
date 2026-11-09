import { useCallback, useEffect, useState } from 'react';
import type { Engine } from '@motionscript/react';
import type { CompositionDocument } from '@motionscript/sdk';
import { Player } from './Player';

/**
 * `engine.registerNode(source)` — a custom node compiled from a TS *string*
 * that default-exports a component, instead of a statically imported one,
 * live, on the same engine the demo picker above already built with
 * `createBrowserEngine`.
 *
 * Nothing here configures a compiler: `createBrowserEngine` (`App.tsx`)
 * already attached `browser`'s own default (`@motionscript/core/sdk` for
 * the SDK surface, a lazily-loaded `esbuild-wasm` for compiling — see
 * `@motionscript/browser/src/dynamic-nodes.ts`). This is the whole
 * integration surface: one `await` call.
 *
 * The source can only `import ... from "@motionscript/sdk"` — no DOM, no
 * network, no filesystem, no relative imports (see `DENIED_GLOBALS` in
 * `@motionscript/core`). That is hardening, not a sandbox: the compiled
 * component has to run in this same page, in the same realm as every built-in
 * node, so it can satisfy `instanceof` and join the same reactive prop
 * graph a worker or an iframe could never let it join.
 */

const STARTER_SOURCE = `import { component2d, Graphics2D, Types } from "@motionscript/sdk";

// The key stays "liveNode" so the preview below (which names that type in
// its own document) keeps rendering it after an edit — rename it and the
// preview will show nothing, because nothing names the new key.
export default component2d({
    key: "liveNode",
    state: { color: Types.fill("#6990dd") },
    render: (ctx, state) => {
        const t = ctx.time.elapsed;
        const d = (70 + Math.sin(t * 2.4) * 18) * 2;
        ctx.draw(new Graphics2D().ellipse({ width: d, height: d }).fill(state.color));
    },
});
`;

const PREVIEW_VIEWPORT = { width: 360, height: 360 };
const PREVIEW_FPS = 60;

/** Root, one `liveNode`, and a `to` — proof it takes commands like any other node. */
const PREVIEW_DOC: CompositionDocument = {
    kind: 'composition',
    nodes: [
        { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: '#0b0d12' } },
        { id: 'live', type: 'liveNode', parentId: null, layerOrder: 1, props: { width: 220, height: 220 } },
    ],
    commands: [
        {
            id: 'live-color', type: 'to', targetId: 'live', at: 0.5, duration: 1.4,
            easing: { kind: 'inOut', args: 'cubic' }, args: { color: '#ff6688' },
        },
    ],
};

export function DynamicNodePlayground({ engine }: { engine: Engine | null }) {
    const [source, setSource] = useState(STARTER_SOURCE);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Bumped on every successful apply, and used as `<Player key>` — the
    // simplest correct way to make sure the preview's session opens fresh
    // against the registry's *current* component rather than one it already
    // built a tree from (see `Registry.addNode`'s `{ replace }` note: nothing
    // already-instantiated updates on its own).
    const [applyCount, setApplyCount] = useState(0);

    const apply = useCallback(async (src: string) => {
        if (!engine) return;
        setBusy(true);
        try {
            await engine.registerNode(src, { replace: true });
            setError(null);
            setApplyCount(c => c + 1);
        } catch (err) {
            // A bad edit doesn't take the working preview down with it — the
            // error shows, the last-applied version keeps playing.
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, [engine]);

    // The starter source, once, as soon as the engine lands.
    useEffect(() => {
        if (engine) void apply(STARTER_SOURCE);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine]);

    return (
        <section className="playground">
            <header>
                <h2>Dynamic node playground</h2>
                <p>
                    <code>engine.registerNode(source)</code> — compiled from this text, live, on the
                    engine above. Edit it and hit apply.
                </p>
            </header>

            <div className="playground-body">
                <div className="playground-editor">
                    <textarea
                        value={source}
                        onChange={e => setSource(e.target.value)}
                        spellCheck={false}
                        disabled={!engine}
                    />
                    <div className="playground-controls">
                        <button
                            className="primary"
                            onClick={() => void apply(source)}
                            disabled={!engine || busy}
                        >
                            {busy ? 'compiling…' : 'apply'}
                        </button>
                        <button onClick={() => setSource(STARTER_SOURCE)} disabled={busy}>
                            reset
                        </button>
                    </div>
                    {error && <pre className="playground-error">{error}</pre>}
                </div>

                <div className="playground-preview">
                    {applyCount > 0
                        ? (
                            <Player
                                key={applyCount}
                                engine={engine}
                                doc={PREVIEW_DOC}
                                viewport={PREVIEW_VIEWPORT}
                                fps={PREVIEW_FPS}
                            />
                        )
                        : <div className="playground-waiting">compiling the starter node…</div>}
                </div>
            </div>
        </section>
    );
}
