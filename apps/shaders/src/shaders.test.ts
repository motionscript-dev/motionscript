import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Registry } from "@motionscript/sdk"
import { describe, expect, it } from "vitest"
import * as barrel from "."
import { AuroraCard, PRISM_SHADER, PrismCard } from "."
import { NODES } from "./nodes"

const here = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(here, "..")

describe("the barrel", () => {
    it("exports the two cards, the prism shader and NODES, and nothing else at run time", () => {
        expect(Object.keys(barrel).sort()).toEqual(["AuroraCard", "NODES", "PRISM_SHADER", "PrismCard"])
        expect(barrel.NODES).toBe(NODES)
    })


    it("lists exactly the two cards in NODES", () => {
        expect(NODES).toHaveLength(2)
        expect(NODES[0]).toBe(AuroraCard)
        expect(NODES[1]).toBe(PrismCard)
    })

    it("registers the keys a document names", () => {
        const registry = new Registry({ builtins: false, nodes: NODES })
        expect(registry.nodeKeys().sort()).toEqual(["auroraCard", "prismCard"])
    })

    it("gives the prism card a fill shader with a source of its own", () => {
        expect(typeof PRISM_SHADER.source).toBe("string")
        expect(PRISM_SHADER.source.length).toBeGreaterThan(0)
    })
})

describe("the package", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
        private?: boolean
        sideEffects?: boolean
        peerDependencies?: Record<string, string>
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
    }

    it("is private, tree-shakeable, and takes the SDK as a peer", () => {
        expect(manifest.private).toBe(true)
        expect(manifest.sideEffects).toBe(false)
        expect(manifest.peerDependencies?.["@motionscript/sdk"]).toBeDefined()
    })

    it("depends on no core package", () => {
        const names = [
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.devDependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
        ]
        expect(names.filter((name) => name.startsWith("@motionscript/core"))).toEqual([])
    })

    it("imports nothing but the SDK and its own files, in every source file", () => {
        const specifiers = fs
            .readdirSync(here)
            .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
            .flatMap((name) =>
                [...fs.readFileSync(path.join(here, name), "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
                    ([, specifier]) => `${name}: ${specifier}`,
                ),
            )
        expect(specifiers.length).toBeGreaterThan(0)
        expect(specifiers.filter((entry) => !/: (\.\/[\w-]+|@motionscript\/sdk)$/.test(entry))).toEqual([])
    })
})

