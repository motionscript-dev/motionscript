import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/audio/mixer";
import { SAMPLE_RATE, bufferOf } from "./audio.fixtures";

/**
 * `encodeWav` is the mixdown's only file representation, so what is asserted
 * here is the bytes: a header a player will accept, and samples in the order and
 * scale it expects.
 */

const ascii = (view: DataView, offset: number, length: number): string =>
    String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length));

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Every sample of the data chunk, as signed 16-bit integers. */
function samples(bytes: Uint8Array): number[] {
    const v = view(bytes);
    const out: number[] = [];
    for (let offset = 44; offset < bytes.byteLength; offset += 2) out.push(v.getInt16(offset, true));
    return out;
}

/** A buffer whose first channel carries exactly `values`, and every other the same negated. */
function carrying(values: readonly number[], channels = 1, rate = SAMPLE_RATE): AudioBuffer {
    const buffer = new AudioBuffer({ length: values.length, numberOfChannels: channels, sampleRate: rate });
    for (let c = 0; c < channels; c++) {
        buffer.getChannelData(c).set(values.map((v) => (c === 0 ? v : -v)));
    }
    return buffer;
}

describe("encodeWav — the header", () => {
    it("is a 44-byte RIFF/WAVE PCM header for the buffer's shape", () => {
        const bytes = encodeWav(bufferOf(0.01, () => 0.25, 2, 22050));
        const v = view(bytes);
        const frames = Math.round(0.01 * 22050);

        expect(bytes.byteLength).toBe(44 + frames * 2 * 2);
        expect(ascii(v, 0, 4)).toBe("RIFF");
        expect(v.getUint32(4, true)).toBe(36 + frames * 4);
        expect(ascii(v, 8, 4)).toBe("WAVE");
        expect(ascii(v, 12, 4)).toBe("fmt ");
        expect(v.getUint32(16, true)).toBe(16);
        expect(v.getUint16(20, true)).toBe(1);
        expect(v.getUint16(22, true)).toBe(2);
        expect(v.getUint32(24, true)).toBe(22050);
        expect(v.getUint32(28, true)).toBe(22050 * 4);
        expect(v.getUint16(32, true)).toBe(4);
        expect(v.getUint16(34, true)).toBe(16);
        expect(ascii(v, 36, 4)).toBe("data");
        expect(v.getUint32(40, true)).toBe(frames * 4);
    });

    it("is a plain Uint8Array over a whole ArrayBuffer of its own", () => {
        const bytes = encodeWav(carrying([0, 0.5]));

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.byteOffset).toBe(0);
        expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
    });

    it("describes a mono buffer with a block align of 2", () => {
        const v = view(encodeWav(carrying([0.1, 0.2, 0.3], 1, 8000)));

        expect(v.getUint16(22, true)).toBe(1);
        expect(v.getUint32(24, true)).toBe(8000);
        expect(v.getUint32(28, true)).toBe(8000 * 2);
        expect(v.getUint16(32, true)).toBe(2);
        expect(v.getUint32(40, true)).toBe(6);
    });
});

describe("encodeWav — the samples", () => {
    it("interleaves channels frame by frame, left first", () => {
        const bytes = encodeWav(carrying([0.5, 0.25, 0.125], 2));

        // The right channel carries the negation of the left.
        expect(samples(bytes)).toEqual([
            16383, -16384,
            8191, -8192,
            4095, -4096,
        ]);
    });

    it("keeps three channels in order too", () => {
        const bytes = encodeWav(carrying([1, 0.5], 3));

        expect(samples(bytes)).toEqual([
            32767, -32768, -32768,
            16383, -16384, -16384,
        ]);
    });

    it("scales a positive sample by 0x7fff and a negative one by 0x8000", () => {
        expect(samples(encodeWav(carrying([1, -1, 0.5, -0.5, 0])))).toEqual([32767, -32768, 16383, -16384, 0]);
    });

    it("clamps a mix that overlapped past full scale instead of wrapping it", () => {
        expect(samples(encodeWav(carrying([1.5, -3, 100, -1.0001])))).toEqual([32767, -32768, 32767, -32768]);
    });

    it("writes silence for a sample that is not a number", () => {
        expect(samples(encodeWav(carrying([NaN, 0.5, NaN])))).toEqual([0, 16383, 0]);
    });

    it("clamps infinities like any other overflow", () => {
        expect(samples(encodeWav(carrying([Infinity, -Infinity])))).toEqual([32767, -32768]);
    });

    it("round-trips through the decoder to within one 16-bit step", async () => {
        const source = bufferOf(0.05, (t) => 0.8 * Math.sin(2 * Math.PI * 440 * t), 2);
        const bytes = encodeWav(source);

        const decoded = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes.buffer.slice(0));

        expect(decoded.numberOfChannels).toBe(2);
        expect(decoded.sampleRate).toBe(SAMPLE_RATE);
        expect(decoded.length).toBe(source.length);
        const want = source.getChannelData(1);
        const got = decoded.getChannelData(1);
        let worst = 0;
        for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(want[i] - got[i]));
        expect(worst).toBeLessThan(1 / 0x7fff);
    });
});
