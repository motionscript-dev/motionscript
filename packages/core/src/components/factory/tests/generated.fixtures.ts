import type { NodeOf } from "@/components/factory/api";

type PropsOf<C> = C extends { readonly node: new (props?: infer P) => unknown } ? P : never;

/**
 * A component's generated class, typed as its node: what a test subclasses to
 * watch an engine hook. A subclass of the component value itself would build
 * the plain generated node, without the subclass's members.
 */
export function generated<C extends { readonly node: new (props?: never) => unknown }>(component: C): new (props?: PropsOf<C>) => NodeOf<C> {
    return component.node as unknown as new (props?: PropsOf<C>) => NodeOf<C>;
}
