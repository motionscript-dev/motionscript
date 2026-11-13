"""Writes studio's architecture-modules.ts from the scratch sources in motionscript/packages/e2e/zz-arch.

Each node's source is made self-contained: the shared drafting kit (`cad-kit.ts`) is inlined in place of
its import, and the two files' SDK imports are merged into one.
"""
import json
import pathlib
import re

SRC = pathlib.Path(__file__).parent
OUT = pathlib.Path(
    r"C:\Users\workk\Projects\motionscript\studio\packages\client\shared\src\features\editor\themes\lib\architecture-modules.ts"
)

SDK = re.compile(r'import \{([^}]*)\} from "@motionscript/sdk"\n')
LOCAL = re.compile(r'import \{[^}]*\} from "\./([a-z-]+)"\n', re.S)


def names(source: str) -> list[str]:
    m = SDK.search(source)
    return [n.strip() for n in m.group(1).split(",") if n.strip()] if m else []


def expand(name: str, seen: set[str], found: list[str]) -> str:
    """`name`.ts with each local import replaced by that file's body (once per node), its SDK names collected."""
    text = (SRC / f"{name}.ts").read_text(encoding="utf8").replace("\r\n", "\n")
    found += names(text)
    text = SDK.sub("", text, count=1)

    def inline(m: re.Match) -> str:
        dep = m.group(1)
        if dep in seen:
            return ""
        seen.add(dep)
        body = re.sub(r"^export ", "", expand(dep, seen, found), flags=re.M)
        return body.strip() + "\n\n"

    return LOCAL.sub(inline, text)


def inline(src: str) -> str:
    found: list[str] = []
    body = expand(src[: -len(".ts")], set(), found)
    values = sorted({n for n in found if not n.startswith("type ")}, key=str.lower)
    types = sorted({n for n in found if n.startswith("type ") and n[5:] not in values}, key=lambda n: n[5:].lower())
    head = "import { " + ", ".join(values + types) + ' } from "@motionscript/sdk"\n'
    # The node's own code follows the kits it was given.
    split = body.rfind("\n/**", 0, body.index("export default"))
    return head + body[:split].rstrip() + "\n\n// --- The node " + "-" * 70 + "\n" + body[split:].lstrip("\n")


def literal(text: str) -> str:
    text = text.replace("\r\n", "\n")
    return "`" + text.replace("\\", "\\\\").replace("`", "\`").replace("${", "\${") + "`"


NODES = [
    ("house", "House", "houseModel", "house.ts", "house.config.json"),
    ("block", "Office block", "blockModel", "block.ts", "block.config.json"),
    ("tower", "Tower", "towerModel", "tower.ts", "tower.config.json"),
    ("frame", "Steel frame", "steelFrame", "frame.ts", "frame.config.json"),
    ("truss", "Truss bridge", "trussBridge", "truss.ts", "truss.config.json"),
    ("site", "Site plate", "sitePlate", "site.ts", "site.config.json"),
    ("plot", "Site plot", "sitePlot", "plot.ts", "plot.config.json"),
]

consts = []
entries = []
for mid, name, key, src, cfg in NODES:
    source = inline(src)
    (SRC / "out" / f"inlined-{src}").write_text(source, encoding="utf8")
    const = mid.upper() + "_SOURCE"
    consts.append(f"const {const} = {literal(source)}\n")
    config = json.loads((SRC / cfg).read_text(encoding="utf8"))
    entries.append(
        f"""  {{
    id: "{mid}",
    name: "{name}",
    key: "{key}",
    source: {const},
    config: {json.dumps(config, indent=2)},
  }},"""
    )

out = f'''import type {{ TemplateModule }} from "@/features/editor/themes/types"

/**
 * The custom nodes the Architecture template (key `architecture`) is drawn
 * with, as the source a workspace module holds: one component per object, each
 * painted with a fill and strokes, drawn as a CAD view (solids in four quiet
 * tones of the fill, outline and fine lines as strokes, dashed hidden lines,
 * dimensions lettered in a single-stroke hand). A house, an office block and a
 * tower rise a storey at a time; a steel frame goes up storey by storey; a
 * Pratt truss bridge tints its members by tension and compression under
 * `load`; a site plate is ruled, and a site plot pegged out on it. Generated
 * from the engine repo's scratch sources (`packages/e2e/zz-arch/gen-modules.py`),
 * where the kits they share are files of their own.
 */

{chr(10).join(consts)}
export const ARCHITECTURE_MODULES: TemplateModule[] = [
{chr(10).join(entries)}
]
'''
OUT.write_text(out, encoding="utf8", newline="\n")
print("wrote", OUT, len(out), "chars")
