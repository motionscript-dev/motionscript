import { useEffect, useMemo, useState } from 'react';
import {
    MotionStage,
    useMotionPlayer,
    usePlayhead,
    type Engine,
    type Player as MotionScriptPlayer,
} from '@motionscript/react';
import type { CompositionDocument, Size2D } from '@motionscript/sdk';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
/** Whole fractions of the viewport, so both axes stay integral — see `renderScale`. */
const RENDER_SCALES = [0.5, 0.75, 1, 2];

export interface PlayerProps {
    /** Built and owned by the host; `null` until the wasm lands. */
    engine: Engine | null;
    /**
     * The clip to play. It carries its own theme; the engine supplies viewport
     * and fps, since those describe the output rather than the content.
     */
    doc: CompositionDocument;
    /** For the stage's CSS aspect ratio only — the render's size is the engine's. */
    viewport: Size2D;
    /** For the transport's frame↔second arithmetic; the render's rate is the engine's. */
    fps: number;
}

/**
 * A player and its stage, plus the controls a host has to build itself.
 *
 * Everything below the canvas is `useMotionPlayer`'s transport — which is the
 * whole surface an editor is built on, so exercising it here is the point.
 */
export function Player({ engine, doc, viewport, fps }: PlayerProps) {
    const player = useMotionPlayer({ engine, document: doc, viewport, fps, loop: true });

    // Deliberately no `usePlayhead` here: subscribing at this level would
    // re-render the transport, the options and the stage on every tick. It is
    // called in `<Scrubber>` instead — the one leaf that displays the frame.

    // A stage concern, not a player one: it changes how many device pixels the
    // frame is drawn into, not what is in it.
    const [renderScale, setRenderScale] = useState(1);
    const [exportProgress, setExportProgress] = useState<number | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const { toggle, seek, step } = player;

    // Space / arrows / home / end — the shortcuts a scrubbing session wants.
    //
    // Every handler here is stable for the player's life and `seek` clamps to
    // the measured timeline itself, so this subscribes once rather than tearing
    // the listener down and re-adding it on every frame.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
            switch (event.key) {
                case ' ': event.preventDefault(); toggle(); break;
                case 'ArrowLeft': event.preventDefault(); step(-(event.shiftKey ? fps : 1)); break;
                case 'ArrowRight': event.preventDefault(); step(event.shiftKey ? fps : 1); break;
                case 'Home': event.preventDefault(); seek(0); break;
                case 'End': event.preventDefault(); seek(Infinity); break;
                default: break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggle, seek, step, fps]);

    const screenshot = async () => {
        const dataUrl = await player.screenshot();
        if (!dataUrl) return;
        download(dataUrl, `frame-${player.playhead.getSnapshot()}.png`);
    };

    const exportVideo = async () => {
        if (exportProgress !== null) return;
        setExportProgress(0);
        setExportError(null);
        try {
            // The session already knows the scenes, viewport, fps and manifest
            // this player was handed — so an export names none of them again,
            // and cannot disagree with what is on screen.
            const session = player.session;
            if (!session) throw new Error('The player has not mounted yet.');
            await session.export({
                onProgress: setExportProgress,
                encode: { download: true },
            });
        } catch (error) {
            setExportError(`Export failed: ${String(error)}`);
        } finally {
            setExportProgress(null);
        }
    };

    const aspect = useMemo(() => `${viewport.width} / ${viewport.height}`, [viewport]);
    const messages = player.errors.map(e => e.message ?? String(e));
    if (exportError) messages.push(exportError);

    return (
        <section className="player">
            <div className="stage" style={{ aspectRatio: aspect }}>
                <MotionStage player={player} renderScale={renderScale} />
                {player.loading && <div className="stage-badge">rendering…</div>}
            </div>

            <div className="transport">
                <button onClick={() => seek(0)} title="Back to start (Home)">⏮</button>
                <button onClick={() => step(-1)} title="Previous frame (←)">◀|</button>
                <button className="primary" onClick={toggle} title="Play / pause (Space)">
                    {player.isPlaying ? '❚❚' : '▶'}
                </button>
                <button onClick={() => step(1)} title="Next frame (→)">|▶</button>

                <Scrubber player={player} />
            </div>

            <div className="options">
                <label>
                    speed
                    <select value={player.speed} onChange={e => player.setSpeed(Number(e.target.value))}>
                        {SPEEDS.map(value => <option key={value} value={value}>{value}×</option>)}
                    </select>
                </label>
                <label>
                    render scale
                    <select value={renderScale} onChange={e => setRenderScale(Number(e.target.value))}>
                        {RENDER_SCALES.map(value => <option key={value} value={value}>{value}×</option>)}
                    </select>
                </label>
                <label className="check">
                    <input
                        type="checkbox"
                        checked={player.loop}
                        onChange={e => player.setLoop(e.target.checked)}
                    />
                    loop
                </label>
                <label className="check">
                    <input
                        type="checkbox"
                        checked={player.muted}
                        onChange={e => player.setMuted(e.target.checked)}
                    />
                    mute
                </label>

                <button onClick={() => void screenshot()}>screenshot</button>
                <button onClick={() => void exportVideo()} disabled={exportProgress !== null}>
                    {exportProgress === null ? 'export mp4 (browser)' : `exporting ${Math.round(exportProgress * 100)}%`}
                </button>
            </div>

            {messages.length > 0 && (
                <ul className="errors">
                    {messages.map((message, i) => <li key={i}>{message}</li>)}
                </ul>
            )}
        </section>
    );
}

/**
 * The playhead's only subscriber, and so the only thing React re-renders at
 * clock rate. Everything above it — the stage included — renders when the
 * transport actually changes.
 */
function Scrubber({ player }: { player: MotionScriptPlayer }) {
    const frame = usePlayhead(player);
    const { totalFrames, duration, fps, seek } = player;

    return (
        <>
            <input
                type="range"
                className="scrub"
                min={0}
                max={Math.max(0, totalFrames - 1)}
                step={1}
                value={Math.min(frame, totalFrames - 1)}
                onChange={event => seek(Number(event.target.value))}
            />

            <span className="readout">
                {(frame / fps).toFixed(2)}s / {duration.toFixed(2)}s
                <em>frame {frame} / {totalFrames - 1}</em>
            </span>
        </>
    );
}

function download(href: string, filename: string): void {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
