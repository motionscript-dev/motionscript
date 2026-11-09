import type { CommandsSpec, Kids, Piece, StateSpec, Values } from "@/components/factory/api";

/**
 * A command as a module exports it: checked against the module's own state
 * where it is written, then loose about the state it is run with, so it fits
 * any component that spreads the module's state in.
 */
type Portable<A> =
    A extends readonly unknown[] ? { readonly args: A; readonly run?: undefined }
    : unknown extends A ? (timeline: any, state: any, children: any) => Piece
    : { readonly args: A; run(timeline: any, state: any, children: any): Piece };

/** A module's commands, typed against the state it exports. */
export function commandsFor<const S extends StateSpec, const C>(
    state: S,
    commands: CommandsSpec<C, S, Values<S>, Kids>,
): { readonly [N in keyof C]: Portable<C[N]> } {
    return commands as never;
}
