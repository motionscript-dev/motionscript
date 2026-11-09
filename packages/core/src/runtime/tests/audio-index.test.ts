import { describe, expect, it } from "vitest";

import { requestOf } from "@/attributes/audio/schedule";
import { AudioIndex } from "@/runtime/audio-index";
import { FakeAssetCatalog, asCatalog, makeAudioRequest } from "@/runtime/runtime.fixtures";

/** Every source is ten seconds long. */
const catalog = asCatalog(new FakeAssetCatalog());
const SRC = "a.mp3";

describe("requestOf", () => {
    it("leaves a clip nothing ends open, carrying its natural length", () => {
        expect(requestOf({ src: SRC, at: 1, trimStart: 2 }, catalog, "s", 0)).toMatchObject({
            id: "s|a.mp3|1|0", ownerId: "s", startAt: 1, endAt: Infinity, open: true, mediaDuration: 8,
        });
    });

    it("bounds a trimmed clip by its trim, sped up, and by `until` if that comes first", () => {
        expect(requestOf({ src: SRC, at: 1, trimEnd: 6, speed: 2 }, catalog, "s", 0).endAt).toBe(4);
        expect(requestOf({ src: SRC, at: 1, trimEnd: 6, speed: 2, until: 2 }, catalog, "s", 0).endAt).toBe(2);
    });

    it("bounds an untrimmed clip with an `until` by whichever ends first", () => {
        expect(requestOf({ src: SRC, until: 3 }, catalog, "s", 0)).toMatchObject({ endAt: 3 });
        expect(requestOf({ src: SRC, until: 30 }, catalog, "s", 0)).toMatchObject({ endAt: 10 });
        expect(requestOf({ src: SRC, until: 30 }, catalog, "s", 0).open).toBeUndefined();
    });

    it("runs a loop until it is cut, and leaves an uncut one open", () => {
        expect(requestOf({ src: SRC, loop: true, trimEnd: 2, until: 7 }, catalog, "s", 0).endAt).toBe(7);
        expect(requestOf({ src: SRC, loop: true }, catalog, "s", 0)).toMatchObject({ open: true, endAt: Infinity });
    });

    it("throws for a source the catalog does not have, however the clip is bounded", () => {
        const missing = asCatalog(new FakeAssetCatalog({}, new Set([SRC])));
        expect(() => requestOf({ src: SRC, trimEnd: 1 }, missing, "s", 0)).toThrow(SRC);
    });
});

describe("AudioIndex", () => {
    it("reports a change only when an owner's requests differ", () => {
        const index = new AudioIndex();
        expect(index.setOwner("a", [makeAudioRequest({ id: "a1" })])).toBe(true);
        expect(index.setOwner("a", [makeAudioRequest({ id: "a1" })])).toBe(false);
        expect(index.setOwner("a", [makeAudioRequest({ id: "a1", volume: 0.5 })])).toBe(true);
        expect(index.setOwner("b", [])).toBe(false);
    });

    it("lists requests owner by owner, keeping an owner's place when it is replaced", () => {
        const index = new AudioIndex();
        index.setOwner("a", [makeAudioRequest({ id: "a1" })]);
        index.setOwner("b", [makeAudioRequest({ id: "b1" }), makeAudioRequest({ id: "b2" })]);
        index.setOwner("a", [makeAudioRequest({ id: "a2" })]);
        expect(index.requests().map((r) => r.id)).toEqual(["a2", "b1", "b2"]);

        expect(index.removeOwner("b")).toBe(true);
        expect(index.removeOwner("b")).toBe(false);
        expect(index.setOwner("a", [])).toBe(true);
        expect(index.requests()).toEqual([]);
    });
});
