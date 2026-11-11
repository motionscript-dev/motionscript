import { createContext } from "@/util/context";
import type { TextStyle } from "@/attributes/text/types";

/**
 * Ordinary {@link createContext} tokens, the same primitive authors use, so theme, text-style, seed and
 * user-defined context travel one path down the node tree.
 */

export const TextStyleToken = createContext<TextStyle>({}, "text-style");

export const ThemeToken = createContext<Record<string, unknown>>({}, "theme");

export const DataToken = createContext<Record<string, unknown>>({}, "data");

/** Consumed by author code; not yet wired into per-node randomness. */
export const SeedToken = createContext<string | number | undefined>(undefined, "seed");
