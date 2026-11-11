import { mostDerived, type PropertyEditor } from "@/attributes/properties/decorator";

/**
 * Marks a method as a command: a named, parameterised animation a host can offer, place on a timeline and store by
 * name. Metadata only. `args` maps a stored command's `params` onto `data`'s keys (see {@link CommandMeta.args}); every
 * command takes one {@link CommandArgs} argument so a manifest can read its shape off `T`.
 *
 * ```ts
 * class Chart extends Node2D<ChartProps> {
 *     showSeries({ data, duration = 1, easing }: CommandArgs<{ index: number }>): Command<ChartProps> { … }
 * }
 * declareMembers(Chart, { showSeries: command({ args: ["index"] }) });
 * ```
 */

/** One argument a command takes, in the same vocabulary a property uses ({@link PropertyEditor}) — a range, an enum, a unit. A bare string is a name with nothing else to say. */
export interface CommandArgDescriptor extends PropertyEditor {
    key: string;
    default?: unknown;
}

export type CommandArg = string | CommandArgDescriptor;

/** Symbol under which `command` metadata is stored on class prototypes. */
export const COMMAND_META = Symbol("commandMeta");

export interface CommandMeta {
    /** The key a host stores and dispatches on: the method name unless `command({ key })` renamed it. */
    key: string;
    method: string;
    /** Display name; built-ins leave this unset and localize by {@link key} instead. */
    name?: string;
    /** Keys of `params` that become `data`'s fields, written here rather than derived from the method's parameter names (a minifier mangles them, and the document vocabulary is `data`/`duration`/`easing`). */
    args?: readonly CommandArg[];
    /** Brings its target in: a timeline holds its first frame from when the target could first show it, so the resting node never flashes up ahead of it (window in `docs/timeline.md`). */
    entrance?: boolean;
}

export interface CommandOptions {
    /** Publishes the method under another key, for a name the method cannot take (a prop, an inherited method). */
    key?: string;
    name?: string;
    args?: readonly CommandArg[];
    entrance?: boolean;
}

/** Every `command` on an instance's class, inherited included, base → subclass; a redeclared key replaces the inherited declaration at the position the base gave it. */
export function getCommandMeta(instance: object): CommandMeta[] {
    return mostDerived<CommandMeta>(instance, COMMAND_META);
}

export function command(options?: CommandOptions) {
    return function (target: object, propertyKey: string | symbol): void {
        const method = propertyKey as string;
        const key = options?.key ?? method;
        if (!Object.prototype.hasOwnProperty.call(target, COMMAND_META)) {
            (target as Record<symbol, unknown>)[COMMAND_META] = [];
        }
        const list = (target as Record<symbol, unknown>)[COMMAND_META] as CommandMeta[];
        if (list.some(m => m.key === key)) return;
        list.push({
            key,
            method,
            ...(options?.name ? { name: options.name } : {}),
            ...(options?.args ? { args: options.args } : {}),
            ...(options?.entrance ? { entrance: true } : {}),
        });
    };
}
