import type { Size2D } from "@/attributes/layout/size";
import type { CornerRadiusResolved, RectCornerRadius } from "@/attributes/shape/corners/corner-radius";
import type { CornerStyleResolved, RectCornerStyle } from "@/attributes/shape/corners/corner-style";
import { Graphics2D } from "@/render/graphics2d";
import type { Values } from "@/components/factory/api";
import { Types, type Attribute } from "@/components/factory/types";

// Typed out so the declarations name what the corners take by their own modules: a kit's emit reaches those through the sdk.
export const state: { cornerRadius: Attribute<RectCornerRadius, CornerRadiusResolved>; cornerStyle: Attribute<RectCornerStyle, CornerStyleResolved> } = {
    cornerRadius: Types.cornerRadius,
    cornerStyle: Types.cornerStyle,
};

/** A rectangle the size of the box, with these corners. */
export function rect(size: Size2D, s: Values<typeof state>): Graphics2D {
    return new Graphics2D().rect({ width: size.width, height: size.height, cornerRadius: s.cornerRadius, cornerStyle: s.cornerStyle });
}
