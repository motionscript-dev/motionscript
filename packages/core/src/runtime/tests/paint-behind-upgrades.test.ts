import { describe, it, expect } from "vitest";

import { Fills } from "@/attributes/shape/fill/chain";
import type { PlaybackController } from "@/runtime/playback-controller";
import { comp, node, openController, probeRegistry, project, track } from "@/runtime/document.fixtures";

/**
 * An interactive upgrade — a better decode of a picture the frame already drew
 * at some resident level — is something a preview paints behind, never waits
 * for. A swap at pointer rate whose paint waited for one held `whenReplaced`,
 * the host's `loading` and every `repaint()` open for the length of a decode.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function discovered(controller: PlaybackController): Promise<void> {
    for (let i = 0; i < 20 && !controller.precomp.complete; i++) await flush();
}

const clip = (props: Record<string, unknown> = {}) => comp([node("p", "probe", { width: 10, height: 10, ...props })], [1]);

function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    return { promise, open };
}

async function parked() {
    const { registry, log } = probeRegistry();
    const opened = openController(project([track("a", clip())]), { registry });
    await discovered(opened.controller);
    await opened.controller.seek(5);
    return { ...opened, log };
}

describe("PlaybackController – upgrades are painted behind, not waited for", () => {
    it("a swap lands at once, a repaint after it draws, and the upgrade repaints when it lands", async () => {
        const { controller, rc, storage } = await parked();
        const upgrade = gate();
        storage.pendingUpgrades = true;
        storage.upgradeGate = upgrade.promise;
        const renders = rc.renderCount;

        controller.setProject(project([track("a", clip({ width: 12 }))]));
        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 1);

        controller.repaint();
        expect(rc.renderCount).toBe(renders + 2);

        upgrade.open();
        await flush();
        expect(rc.renderCount).toBe(renders + 3);
        await flush();
        expect(rc.renderCount).toBe(renders + 3);
    });

    it("a seek lands at once and repaints behind the upgrade", async () => {
        const { controller, rc, storage, log } = await parked();
        const upgrade = gate();
        storage.pendingUpgrades = true;
        storage.upgradeGate = upgrade.promise;
        const renders = rc.renderCount;

        await controller.seek(7);
        expect(rc.renderCount).toBe(renders + 1);

        upgrade.open();
        await flush();
        expect(rc.renderCount).toBe(renders + 2);
        expect(log.renderTimes.at(-1)).toBeCloseTo(0.7);
    });

    it("a screenshot waits for the upgrade and captures what it drew", async () => {
        const { controller, rc, storage } = await parked();
        const upgrade = gate();
        storage.pendingUpgrades = true;
        storage.upgradeGate = upgrade.promise;
        const renders = rc.renderCount;

        let captured: string | undefined;
        const shot = controller.screenshot().then((url) => { captured = url; });
        await flush();
        expect(captured).toBeUndefined();
        expect(rc.renderCount).toBe(renders + 1);

        upgrade.open();
        await shot;
        expect(captured).toBe(rc.screenshotValue);
        expect(rc.renderCount).toBe(renders + 2);
        await flush();
        expect(rc.renderCount).toBe(renders + 2);
    });

    it("an upgrade landing after a swap rendered, but before it landed, repaints once when it lands", async () => {
        const { controller, rc, storage } = await parked();
        const upgrade = gate();
        storage.pendingUpgrades = true;
        storage.upgradeGate = upgrade.promise;
        // Start the background repaint: it parks on the upgrade.
        controller.repaint();
        const renders = rc.renderCount;

        let releaseWarm!: (more: boolean) => void;
        storage.warmGate = new Promise<boolean>((resolve) => { releaseWarm = resolve; });
        controller.setProject(project([track("a", clip({ width: 12 }))]));
        await flush();
        expect(rc.renderCount).toBe(renders + 1);

        // The swap drew below the upgrade, and is still settling its own decodes.
        upgrade.open();
        await flush();
        expect(rc.renderCount).toBe(renders + 1);

        storage.warmGate = null;
        releaseWarm(false);
        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 2);
    });

    it("an upgrade landing before a swap renders costs no extra paint", async () => {
        const { controller, rc, storage } = await parked();
        const upgrade = gate();
        storage.pendingUpgrades = true;
        storage.upgradeGate = upgrade.promise;
        controller.repaint();
        const renders = rc.renderCount;

        const load = gate();
        const realLoad = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            realLoad(key, record);
            return load.promise;
        };
        controller.setProject(project([track("a", clip({ fill: Fills.image("new.png") }))]));
        upgrade.open();
        await flush();
        expect(rc.renderCount).toBe(renders);

        load.open();
        await controller.whenReplaced();
        await flush();
        expect(rc.renderCount).toBe(renders + 1);
    });

    it("does not repaint behind an upgrade while playing", async () => {
        const { controller, rc, storage, clock } = await parked();
        const upgrade = gate();
        storage.pendingUpgrades = true;
        storage.upgradeGate = upgrade.promise;
        controller.repaint();
        const renders = rc.renderCount;

        clock.play(1, false);
        upgrade.open();
        await flush();
        expect(rc.renderCount).toBe(renders);
    });
});
