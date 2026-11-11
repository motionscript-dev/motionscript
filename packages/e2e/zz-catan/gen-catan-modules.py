"""Writes studio's catan-modules.ts from the scratch sources and configs in motionscript/packages/e2e/zz-catan."""
import json
import pathlib

SRC = pathlib.Path(r"C:\Users\workk\Projects\motionscript\motionscript\packages\e2e\zz-catan")
OUT = pathlib.Path(
    r"C:\Users\workk\Projects\motionscript\studio\packages\client\shared\src\features\editor\themes\lib\catan-modules.ts"
)


def literal(text: str) -> str:
    text = text.replace("\r\n", "\n")
    return "`" + text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


board = (SRC / "hex-board.ts").read_text(encoding="utf8")
piece = (SRC / "game-piece.ts").read_text(encoding="utf8")
board_config = json.loads((SRC / "hex-board.config.json").read_text(encoding="utf8"))
piece_config = json.loads((SRC / "game-piece.config.json").read_text(encoding="utf8"))

out = f'''import type {{ TemplateModule }} from "@/features/editor/themes/types"

/**
 * The custom nodes the Catan template (key `catan`) is drawn with, as the
 * source a workspace module holds. `hexBoard` is the whole board: tiles,
 * scenery, number tokens, harbors and the tray, with `assemble` and
 * `spotlight` commands. `gamePiece` is a settlement, city or road, cel-shaded
 * with baked flat tones (the sun turns with the piece's own `rotationY`) so it
 * reads 2.5D under any light. The board's water photo is embedded as grey
 * levels in `WATER_PHOTO`, because a built-in template cannot ship a picture
 * (`BUNDLED_TEMPLATE_ASSETS` is empty, and `tmpl:` references do not render).
 */

const BOARD_SOURCE = {literal(board)}

const PIECE_SOURCE = {literal(piece)}

export const CATAN_MODULES: TemplateModule[] = [
  {{
    id: "board",
    name: "Hex board",
    key: "hexBoard",
    source: BOARD_SOURCE,
    config: {json.dumps(board_config, indent=2)},
  }},
  {{
    id: "piece",
    name: "Game piece",
    key: "gamePiece",
    source: PIECE_SOURCE,
    config: {json.dumps(piece_config, indent=2)},
  }},
]
'''
OUT.write_text(out, encoding="utf8", newline="\n")
print("wrote", OUT, len(out), "chars")
