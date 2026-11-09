import { useState, type ChangeEvent, type CSSProperties } from "react";
import type { Engine, ProjectDocument, VisualDocument, Size2D } from "@motionscript/core";
import { MotionStage, useMotionPlayer, usePlayhead } from "../src";

type Props = {
    /** Built by the host and shared; `null` until the wasm lands. */
    engine: Engine | null;
    viewport: Size2D;
    fps: number;
    /** Hoisted by the caller: a new object is a new document to reconcile. */
    document: ProjectDocument | VisualDocument;
};

export function ScriptEmbed({ engine, viewport, fps, document: source }: Props) {
    const player = useMotionPlayer({ engine, document: source, viewport, fps });
    // Subscribed here because this embed is small enough that re-rendering all
    // of it per tick is free. Anything with a real control panel should push
    // this down into the leaf that shows the frame — see `apps/react`'s
    // `<Scrubber>`, which is what keeps its stage and transport off the clock.
    const frame = usePlayhead(player);

    const [exportProgress, setExportProgress] = useState<number | null>(null);

    const currentTime = frame / fps;
    const { duration } = player;

    const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
        player.seek(Math.round(parseFloat(e.target.value) * fps));
    };

    const handleScreenshot = async () => {
        try {
            const dataUrl = await player.screenshot();
            if (!dataUrl) {
                console.error("Screenshot returned undefined");
                return;
            }
            const link = document.createElement("a");
            link.href = dataUrl;
            link.download = `frame-${currentTime.toFixed(2)}s.png`;
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error("Failed to capture screenshot:", error);
        }
    };

    const handleExport = async () => {
        if (exportProgress !== null) return;
        setExportProgress(0);
        try {
            // The session already knows the document, viewport, fps and manifest
            // this player was handed, so an export names none of them again and
            // cannot disagree with what is on screen.
            const session = player.session;
            if (!session) throw new Error("The player has not mounted yet.");
            await session.export({ onProgress: setExportProgress, encode: { download: true } });
        } catch (error) {
            console.error("Export failed:", error);
        } finally {
            setExportProgress(null);
        }
    };

    return (
        <div className="script-player-container">
            <div className="scene-wrapper">
                <MotionStage player={player} />
            </div>

            <div className="player-controls">
                <button className="play-toggle-btn" onClick={player.toggle}>
                    {player.isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="player-icon">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="player-icon ">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                        </svg>
                    )}
                </button>

                <button className="play-toggle-btn" onClick={() => void handleScreenshot()}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="player-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                    </svg>
                </button>

                <button
                    className="play-toggle-btn"
                    onClick={() => void handleExport()}
                    disabled={exportProgress !== null}
                >
                    {exportProgress !== null
                        ? `Exporting ${Math.round(exportProgress * 100)}%`
                        : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="player-icon">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                        )}
                </button>

                <input
                    type="range"
                    className="time-slider"
                    min={0}
                    max={duration}
                    step={0.01}
                    value={currentTime}
                    onChange={handleSliderChange}
                    style={{ "--progress": `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
                />

                <span className="time-display">
                    {currentTime.toFixed(1)} / {duration.toFixed(1)}s
                </span>

                {player.loading && (
                    <svg className="player-icon loading-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                    </svg>
                )}
            </div>
        </div>
    );
}
