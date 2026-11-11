---
"@motionscript/renderer": patch
---

A Text with a Write On reveal (`start`/`end` short of the whole string) or styled `runs` drew nothing at all: the renderer ignored the text's pieces while core left their painting to them. Each piece now draws with its own fill and stroke, the unrevealed characters held in place but clear, so a Write On types the text on character by character.
