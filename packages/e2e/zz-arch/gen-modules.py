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
KIT = re.compile(r'import \{[^}]*\} from "\./cad-kit"\n', re.S)


def names(source: str) -> list[str]:
    m = SDK.search(source)
    return [n.strip() for n in m.group(1).split(",") if n.strip()] if m else []


def inline(node: str, kit: str) -> str:
    found = names(kit) + names(node)
    values = sorted({n for n in found if not n.startswith("type ")}, key=str.lower)
    types = sorted({n for n in found if n.startswith("type ") and n[5:] not in values}, key=lambda n: n[5:].lower())
    head = "import { " + ", ".join(values + types) + ' } from "@motionscript/sdk"\n'
    body = SDK.sub("", kit, count=1)
    body = re.sub(r"^export ", "", body, flags=re.M)
    node = SDK.sub("", node, count=1)
    assert KIT.search(node), "no kit import"
    return head + KIT.sub(lambda _: body.strip() + "\n\n// --- The node " + "-" * 70 + "\n", node, count=1)


def literal(text: str) -> str:
    text = text.replace("\r\n", "\n")
    return "`" + text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


kit = (SRC / "cad-kit.ts").read_text(encoding="utf8")
NODES = [
    ("building", "Building", "building", "building.ts", "building.config.json"),
    ("structure", "Structure", "structure", "structure.ts", "structure.config.json"),
    ("site", "Site plate", "sitePlate", "site.ts", "site.config.json"),
]

consts = []
entries = []
for mid, name, key, src, cfg in NODES:
    source = inline((SRC / src).read_text(encoding="utf8"), kit)
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
 * with, as the source a workspace module holds. Each is drawn as a CAD view:
 * solids in four quiet tones, hairline edges, dashed hidden lines, and
 * dimensions lettered in a single-stroke hand (geometry, not textures).
 * `building` is a house, block or tower that rises a storey at a time;
 * `structure` is a steel frame put up storey by storey, or a Pratt truss
 * bridge whose members colour by tension and compression under `load`;
 * `sitePlate` is the ruled plate a massing model stands on. Generated from
 * the engine repo's scratch sources (`packages/e2e/zz-arch/gen-modules.py`),
 * where the drafting kit they share is one file.
 */

{chr(10).join(consts)}
export const ARCHITECTURE_MODULES: TemplateModule[] = [
{chr(10).join(entries)}
]
'''
OUT.write_text(out, encoding="utf8", newline="\n")
print("wrote", OUT, len(out), "chars")
