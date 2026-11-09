import { createBrowserEngine } from "@motionscript/browser";
import { useEngine } from "../src";
import { ScriptEmbed } from "./embed";
import shapeScene from "./scenes/shape";

const youtubeRes = { width: 1920, height: 1080 };

// On the engine, not the player: what media *is* does not change per player.
const ASSETS = {
    image: {
        'background.jpg': {
            sizeBytes: 501375,
            src: './background.jpg',
            width: 2880,
            height: 1800
        }
    },
    video: {
        'video.mp4': {
            sizeBytes: 14220122,
            duration: 11,
            src: './video.mp4',
            width: 1080,
            height: 1080
        }
    },
    audio: {
        "click.mp3": {
            sizeBytes: 38552,
            src: "./click.mp3",
            duration: 0.5,
        },
        "song.mp3": {
            sizeBytes: 4237270,
            src: "./song.mp3",
            duration: 132,
        }
    },
    font: {
        'Roboto@400': {
            fontFamily: 'Roboto',
            fontWeight: 400,
            src: './Roboto-Regular.ttf',
            sizeBytes: 159108
        }
    }
};

export function App() {
    // The host owns the engine. Built once, shared by every player under it —
    // it holds the renderer and the exporter, so a second one is a second wasm
    // module and a second GL stack.
    const engine = useEngine(() => createBrowserEngine({ manifest: ASSETS }));

    return (
        <div className="app-shell">
            <ScriptEmbed engine={engine} viewport={youtubeRes} fps={60} document={shapeScene} />
        </div>
    );
}
