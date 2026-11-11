import type { AudioRequest } from "@/attributes/audio/request";

/** Every owner's declared audio, kept apart so one owner can change without redeclaring the rest. */
export class AudioIndex {
    setOwner(ownerKey: string, requests: AudioRequest[]): boolean {
        if (requests.length === 0) return this.removeOwner(ownerKey);
        const prior = this._owners.get(ownerKey);
        if (prior && sameValue(prior, requests)) return false;
        this._owners.set(ownerKey, requests);
        return true;
    }

    removeOwner(ownerKey: string): boolean {
        return this._owners.delete(ownerKey);
    }

    requests(): AudioRequest[] {
        const out: AudioRequest[] = [];
        for (const requests of this._owners.values()) out.push(...requests);
        return out;
    }

    private readonly _owners = new Map<string, AudioRequest[]>();
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (!sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }
    return true;
}
