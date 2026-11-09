import {
    AudioBufferSource,
    Mp3OutputFormat,
    Mp4OutputFormat,
    WavOutputFormat,
    WebMOutputFormat,
    canEncodeAudio,
    type AudioCodec,
    type OutputFormat,
    type VideoCodec,
} from "mediabunny";

/** A file with a picture: rendered frame by frame, with the mixed audio as a second track. */
export type VideoFormat = "mp4" | "webm";
/** A file of the timeline's mixed audio alone; nothing is drawn. */
export type AudioFormat = "wav" | "mp3" | "m4a";
export type ExportFormat = VideoFormat | AudioFormat;

/** What a host needs to name, save and play an exported file. */
export interface ExportFormatInfo {
    kind: "video" | "audio";
    /** Without the dot. */
    extension: string;
    mimeType: string;
}

interface FormatSpec extends ExportFormatInfo {
    container: () => OutputFormat;
    audioCodec: AudioCodec;
    /** Video formats only: what the container takes, the default first, and the codec used unprobed when none of those encode. */
    video?: { codecs: readonly VideoCodec[]; fallback: VideoCodec };
}

const FORMATS: Record<ExportFormat, FormatSpec> = {
    mp4: {
        kind: "video", extension: "mp4", mimeType: "video/mp4",
        container: () => new Mp4OutputFormat(),
        audioCodec: "aac",
        video: { codecs: ["avc", "hevc", "av1", "vp9"], fallback: "avc" },
    },
    webm: {
        kind: "video", extension: "webm", mimeType: "video/webm",
        container: () => new WebMOutputFormat(),
        audioCodec: "opus",
        video: { codecs: ["vp9", "av1", "vp8"], fallback: "vp8" },
    },
    wav: {
        kind: "audio", extension: "wav", mimeType: "audio/wav",
        container: () => new WavOutputFormat(),
        audioCodec: "pcm-s16",
    },
    mp3: {
        kind: "audio", extension: "mp3", mimeType: "audio/mpeg",
        container: () => new Mp3OutputFormat(),
        audioCodec: "mp3",
    },
    m4a: {
        kind: "audio", extension: "m4a", mimeType: "audio/mp4",
        container: () => new Mp4OutputFormat(),
        audioCodec: "aac",
    },
};

export const EXPORT_FORMATS: Readonly<Record<ExportFormat, ExportFormatInfo>> = FORMATS;

export function formatSpec(format: ExportFormat): FormatSpec {
    const spec = FORMATS[format];
    if (!spec) throw new RangeError(`"${String(format)}" is not an export format; expected one of ${Object.keys(FORMATS).join(", ")}.`);
    return spec;
}

export function isAudioFormat(format: ExportFormat): format is AudioFormat {
    return formatSpec(format).kind === "audio";
}

export const DEFAULT_AUDIO_BITRATE = 192_000;
const OPUS_SAMPLE_RATE = 48_000;

/** The mixed-audio track for `format`. Ensure its encoder first with {@link ensureAudioEncoder}. */
export function audioTrackSource(format: ExportFormat, bitrate = DEFAULT_AUDIO_BITRATE): AudioBufferSource {
    const codec = formatSpec(format).audioCodec;
    return new AudioBufferSource({
        codec,
        bitrate,
        // Opus encodes at 48 kHz only, and the mix runs at 44.1 kHz unless asked otherwise.
        ...(codec === "opus" && { transform: { sampleRate: OPUS_SAMPLE_RATE } }),
    });
}

let mp3Registered: Promise<void> | null = null;

/**
 * Throws before a frame is rendered when this browser cannot encode `format`'s
 * audio. No browser ships an MP3 encoder, so LAME is loaded on first use (a
 * WASM worker from a `blob:` URL, which a host's CSP must allow).
 */
export async function ensureAudioEncoder(format: ExportFormat): Promise<void> {
    const codec = formatSpec(format).audioCodec;
    if (codec === "mp3") {
        mp3Registered ??= (async () => {
            if (await canEncodeAudio("mp3")) return;
            const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
            registerMp3Encoder();
        })();
        try {
            await mp3Registered;
        } catch (error) {
            mp3Registered = null;
            throw error;
        }
        return;
    }
    if (codec.startsWith("pcm-")) return;
    if (!(await canEncodeAudio(codec))) {
        throw new Error(`This browser has no ${codec.toUpperCase()} encoder, so it cannot export ${format.toUpperCase()} audio.`);
    }
}
