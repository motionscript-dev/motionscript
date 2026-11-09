import { describe, it, expect } from 'vitest';
import { property, getPropertyMeta, PROPERTY_META } from '@/attributes/properties/decorator';

describe('property + getPropertyMeta', () => {
    it('registers a property with its default on the prototype', () => {
        class Node2D { }
        property({ default: 0 })(Node2D.prototype, 'x');

        const meta = getPropertyMeta(new Node2D());
        expect(meta).toHaveLength(1);
        expect(meta[0]).toMatchObject({ key: 'x', default: 0 });
    });

    it('omits options when neither mapper nor tween is given', () => {
        class Node2D { }
        property({ default: 1 })(Node2D.prototype, 'a');
        expect(getPropertyMeta(new Node2D())[0].options).toBeUndefined();
    });

    it('captures mapper/tween into options when provided', () => {
        class Node2D { }
        const mapper = (v: number) => v * 2;
        property({ mapper })(Node2D.prototype, 'scaled');
        const meta = getPropertyMeta(new Node2D())[0];
        expect(meta.options?.mapper).toBe(mapper);
    });

    it('does not register the same key twice on one class', () => {
        class Node2D { }
        property({ default: 0 })(Node2D.prototype, 'x');
        property({ default: 5 })(Node2D.prototype, 'x');
        const meta = getPropertyMeta(new Node2D());
        expect(meta.filter((m) => m.key === 'x')).toHaveLength(1);
    });

    it('orders inherited metadata base→subclass and dedupes by key', () => {
        class Base { }
        property({ default: 1 })(Base.prototype, 'base');

        class Sub extends Base { }
        property({ default: 2 })(Sub.prototype, 'sub');

        const meta = getPropertyMeta(new Sub());
        const keys = meta.map((m) => m.key);
        expect(keys).toEqual(['base', 'sub']);
    });

    it('lets a subclass redeclaration replace the inherited one, in the base position', () => {
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const snap = (a: number, b: number, t: number) => (t < 1 ? a : b);

        class Base { }
        property({ default: 1, min: 0, max: 10, tween: lerp })(Base.prototype, 'level');
        property({ default: 'a' })(Base.prototype, 'label');

        class Sub extends Base { }
        property({ default: 2 })(Sub.prototype, 'extra');
        property({ default: 7, min: 5, max: 20, step: 0.5, tween: snap })(Sub.prototype, 'level');

        const meta = getPropertyMeta(new Sub());
        expect(meta.map((m) => m.key)).toEqual(['level', 'label', 'extra']);
        expect(meta[0]).toEqual({
            key: 'level',
            default: 7,
            options: { mapper: undefined, tween: snap },
            editor: { min: 5, max: 20, step: 0.5 },
        });
        // The base class's own view is untouched.
        expect(getPropertyMeta(new Base())[0]).toMatchObject({ default: 1, options: { tween: lerp } });
    });

    it('takes the most-derived of several redeclarations', () => {
        class A { }
        property({ default: 1 })(A.prototype, 'v');
        class B extends A { }
        property({ default: 2 })(B.prototype, 'v');
        class C extends B { }
        class D extends C { }
        property({ default: 4 })(D.prototype, 'v');

        expect(getPropertyMeta(new C()).map((m) => m.default)).toEqual([2]);
        expect(getPropertyMeta(new D()).map((m) => m.default)).toEqual([4]);
    });

    it('stores metadata under the PROPERTY_META symbol', () => {
        class Node2D { }
        property({ default: 0 })(Node2D.prototype, 'x');
        expect(Array.isArray((Node2D.prototype as any)[PROPERTY_META])).toBe(true);
    });
});
