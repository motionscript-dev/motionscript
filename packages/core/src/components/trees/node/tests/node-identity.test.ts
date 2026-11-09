import { describe, it, expect } from 'vitest';
import { Node2D } from '@/components/trees/2d/node2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Box3D } from "@/components/builtins/three/three";
import { getPropertyMeta } from '@/attributes/properties/decorator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Node identity', () => {
    it('falls back to a UUID when no id is given', () => {
        expect(new Rect({}).id).toMatch(UUID);
        expect(new Node2D().id).toMatch(UUID);
    });

    it('gives each node without an id one of its own', () => {
        const ids = new Set(Array.from({ length: 50 }, () => new Rect({}).id));
        expect(ids.size).toBe(50);
    });

    it('keeps an id it is given', () => {
        expect(new Rect({ id: 'card' }).id).toBe('card');
        expect(new Box3D({ id: 'cube' } as never).id).toBe('cube');
    });

    it('keeps an empty id, which is the scene root\'s own, rather than replacing it', () => {
        expect(new Rect({ id: '' }).id).toBe('');
        expect(new Node2D({ id: '' }).id).toBe('');
    });

    it('falls back to a UUID for an id that is explicitly undefined', () => {
        expect(new Rect({ id: undefined }).id).toMatch(UUID);
    });

    it('keeps an id that is not a UUID or a plain word as it is', () => {
        for (const id of ['@bus', 'a.b', 'with space', '0']) expect(new Rect({ id }).id).toBe(id);
    });

    it('passes a key through, and leaves it unset otherwise', () => {
        expect(new Rect({ key: 'hero' }).key).toBe('hero');
        expect(new Rect({}).key).toBeUndefined();
        expect(new Rect({ id: 'x' }).key).toBeUndefined();
    });

    it('keeps an empty key', () => {
        expect(new Rect({ key: '' }).key).toBe('');
    });

    it('never generates a key', () => {
        expect(new Rect({ id: 'a' }).key).toBeUndefined();
        expect(new Node2D().key).toBeUndefined();
    });

    it('treats id and key as independent', () => {
        const node = new Rect({ id: 'row-1', key: 'card' });
        expect([node.id, node.key]).toEqual(['row-1', 'card']);
    });

    it('is not a property: neither id nor key is declared, stored or collected', () => {
        const node = new Rect({ id: 'a', key: 'b' });
        const declared = getPropertyMeta(node).map((meta) => meta.key);
        expect(declared).not.toContain('id');
        expect(declared).not.toContain('key');
        expect(node.__cells?.slots.has('id')).toBe(false);
        expect(node.__cells?.slots.has('key')).toBe(false);
        expect(node.properties).not.toHaveProperty('id');
        expect(node.properties).not.toHaveProperty('key');
    });

    it('is not written by set, so the identity does not tween or restore', () => {
        const node = new Rect({ id: 'a', key: 'b' });
        node.set({ id: 'other', key: 'other' } as never);
        expect([node.id, node.key]).toEqual(['a', 'b']);
    });

    it('survives save and restore, which only touch properties', () => {
        const node = new Rect({ id: 'a', key: 'b', x: 1 });
        node.save();
        node.set({ x: 9 });
        node.restore();
        expect([node.id, node.key, node.x]).toEqual(['a', 'b', 1]);
    });

    it('is set before any default is applied, so a binding built in the constructor can name it', () => {
        let seen: string | undefined;
        class Probe extends Node2D {
            constructor(props: { id?: string }) {
                super(props);
                seen = this.id;
            }
        }
        new Probe({ id: 'early' });
        expect(seen).toBe('early');
    });

    it('does not change when props are set or tweened', () => {
        const node = new Rect({ id: 'fixed' });
        node.set({ x: 4 });
        node.to({ data: { x: 8 }, duration: 1 }).at(1);
        expect(node.id).toBe('fixed');
    });
});
