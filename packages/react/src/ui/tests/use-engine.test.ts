import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "@motionscript/core";
import { useEngine, type UseEngineOptions } from "../use-engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeEngine {
    id: number;
    dispose: ReturnType<typeof vi.fn>;
}

describe("useEngine", () => {
    let container: HTMLElement;
    let root: Root;
    let seen: Engine | null;
    let built: FakeEngine[];

    const create = vi.fn(async () => {
        const engine: FakeEngine = { id: built.length, dispose: vi.fn() };
        built.push(engine);
        return engine as unknown as Engine;
    });

    function Harness(props: { options?: UseEngineOptions; factory?: () => Promise<Engine> }): ReactElement | null {
        seen = useEngine(props.factory ?? (() => create()), props.options);
        return null;
    }

    async function render(props: Parameters<typeof Harness>[0] = {}, strict = false) {
        const element = createElement(Harness, props);
        await act(async () => {
            root.render(strict ? createElement(StrictMode, null, element) : element);
        });
    }

    beforeEach(() => {
        built = [];
        seen = null;
        create.mockClear();
        container = document.createElement("div");
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
    });

    it("is null until the engine is built, then hands it over", async () => {
        let resolve!: (engine: Engine) => void;
        await render({ factory: () => new Promise<Engine>(r => (resolve = r)) });
        expect(seen).toBeNull();

        const engine = { dispose: vi.fn() } as unknown as Engine;
        await act(async () => resolve(engine));
        expect(seen).toBe(engine);
    });

    it("builds once, however often it re-renders", async () => {
        await render();
        await render();
        await render({ factory: () => create() });
        expect(create).toHaveBeenCalledTimes(1);
        expect(built[0].dispose).not.toHaveBeenCalled();
    });

    it("disposes the engine on unmount", async () => {
        await render();
        await act(async () => root.unmount());
        expect(built[0].dispose).toHaveBeenCalledTimes(1);
        root = createRoot(container);
    });

    it("disposes an engine that lands after the unmount, and never hands it out", async () => {
        let resolve!: (engine: Engine) => void;
        await render({ factory: () => new Promise<Engine>(r => (resolve = r)) });
        await act(async () => root.unmount());

        const late = { dispose: vi.fn() } as unknown as Engine;
        await act(async () => resolve(late));
        expect(late.dispose).toHaveBeenCalledTimes(1);
        expect(seen).toBeNull();
        root = createRoot(container);
    });

    it("survives StrictMode's double mount with one live engine", async () => {
        await render({}, true);
        expect(create).toHaveBeenCalledTimes(2);
        expect(built[0].dispose).toHaveBeenCalledTimes(1);
        expect(built[1].dispose).not.toHaveBeenCalled();
        expect(seen).toBe(built[1]);
    });

    it("rebuilds when deps change, disposing the old engine first", async () => {
        await render({ options: { deps: ["a"] } });
        expect(seen).toBe(built[0]);

        await render({ options: { deps: ["b"] } });
        expect(built[0].dispose).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledTimes(2);
        expect(seen).toBe(built[1]);
    });

    it("reports a rejection to onError and stays null", async () => {
        const boom = new Error("no wasm");
        const onError = vi.fn();
        await render({ factory: () => Promise.reject(boom), options: { onError } });
        expect(onError).toHaveBeenCalledWith(boom);
        expect(seen).toBeNull();
    });

    it("reports a factory that throws before returning a promise", async () => {
        const boom = new Error("bad options");
        const onError = vi.fn();
        await render({
            factory: () => {
                throw boom;
            },
            options: { onError },
        });
        expect(onError).toHaveBeenCalledWith(boom);
    });

    it("logs a rejection when there is no onError", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const boom = new Error("no wasm");
        await render({ factory: () => Promise.reject(boom) });
        expect(log).toHaveBeenCalledWith("Could not start the MotionScript engine.", boom);
        log.mockRestore();
    });
});
