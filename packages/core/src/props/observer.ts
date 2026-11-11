import { _setObserver, type PropSlot } from "./slot";

/** What the slots touched inside {@link observeSlots} are reported to. Reads and writes are recorded rather than declared: a dependency is whatever a computation actually touched, bindings included, so nothing annotates a prop as mattering to anyone. */
export interface SlotObserver {
    read(slot: PropSlot<unknown>): void;
    write(slot: PropSlot<unknown>): void;
    /** A node's clock was read — a result that depends on it is not a function of slots alone. */
    clock?(host: { readonly id: string }): void;
}

/** The {@link PropSlot._name} of `Node2D`'s laid-out box. */
export const LAYOUT_SLOT = "layoutBounds";
/** A document variable's slot is named this plus the variable id. */
export const VAR_PREFIX = "var:";
/** A timeline node's presence pseudo-slot is named this plus the node id. */
export const PRESENCE_PREFIX = "presence:";
/** A node's child list and parent link, as a pseudo-slot on that node. */
export const STRUCTURE_SLOT = "structure";

/** Run `fn` with every slot read and write reported to `observer`. An inner scope shadows an outer one. */
export function observeSlots<T>(observer: SlotObserver, fn: () => T): T {
    const previous = _setObserver(observer);
    try {
        return fn();
    } finally {
        _setObserver(previous);
    }
}

/** Run `fn` with nothing observing, inside a scope that is. */
export function unobserved<T>(fn: () => T): T {
    const previous = _setObserver(null);
    try {
        return fn();
    } finally {
        _setObserver(previous);
    }
}

/** `"card.x"` for a node's prop, the bare name for a hostless slot (`"var:g"`). */
export function slotLabel(slot: PropSlot<unknown>): string {
    return slot._host ? `${slot._host.id}.${slot._name}` : slot._name;
}
