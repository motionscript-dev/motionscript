import { useEffect, useState } from 'react';
import { createBrowserEngine } from '@motionscript/browser';
import { useEngine } from '@motionscript/react';
import { Player } from './player/Player';
import { DynamicNodePlayground } from './player/DynamicNodePlayground';
import { DEMOS, FPS, VIEWPORT, assetManifest, probeFont } from './scenes';
import { nodes, shaders } from './project';

export function App() {
    const [selected, setSelected] = useState(DEMOS[0]!.id);
    const [fontBytes, setFontBytes] = useState<number | null | undefined>(undefined);

    // Built once and shared: the engine holds the renderer and the exporter, so
    // rebuilding it tears the GPU surface out from under every player on it.
    const engine = useEngine(async () => {
        const next = await createBrowserEngine({ nodes, shaders, viewport: VIEWPORT, fps: FPS });
        // Before the engine is handed out, not in an effect beside it: child
        // effects run before the parent's, so a player would open its session
        // — and resolve its assets — against an empty catalog and never find
        // the audio.
        next.setManifest(assetManifest(null));
        return next;
    });

    useEffect(() => {
        const controller = new AbortController();
        void probeFont(controller.signal).then(setFontBytes);
        return () => controller.abort();
    }, []);

    const hasFont = typeof fontBytes === 'number';

    // Fold the font in once the probe lands. On the engine rather than a
    // player: what media *is* does not change per player, and swapping it keeps
    // every decode already cached.
    useEffect(() => {
        if (!engine || fontBytes === undefined) return;
        engine.setManifest(assetManifest(hasFont ? fontBytes : null));
    }, [engine, hasFont, fontBytes]);

    const demo = DEMOS.find(entry => entry.id === selected)!;

    return (
        <main className="app">
            <header>
                <h1>Motion Script</h1>
                <p>
                    A <code>useMotionPlayer</code> and a <code>MotionStage</code> with hand-rolled
                    controls — the surface a host builds an editor on. Space plays, ←/→ step a
                    frame, shift+←/→ a second.
                </p>
            </header>

            <nav className="scene-picker">
                {DEMOS.map(entry => {
                    const blocked = Boolean(entry.requiresFont) && !hasFont;
                    return (
                        <button
                            key={entry.id}
                            className={entry.id === selected ? 'active' : undefined}
                            disabled={blocked}
                            title={blocked ? 'Add public/fonts/Inter.ttf to enable this scene.' : undefined}
                            onClick={() => setSelected(entry.id)}
                        >
                            <strong>{entry.name}</strong>
                            <span>
                                {entry.description}
                                {blocked && ' — needs public/fonts/Inter.ttf'}
                            </span>
                        </button>
                    );
                })}
            </nav>

            <Player engine={engine} doc={demo.doc} viewport={VIEWPORT} fps={FPS} />

            <DynamicNodePlayground engine={engine} />
        </main>
    );
}
