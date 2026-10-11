"""Build exact Type 1 glyph outlines for Canvas (fonttools required at build time)."""
import json, pathlib
from fontTools.t1Lib import T1Font
from fontTools.pens.svgPathPen import SVGPathPen
root=pathlib.Path('vendor/engine/bundles')
out=pathlib.Path('vendor/type1');out.mkdir(parents=True,exist_ok=True)
for p in root.rglob('*.pfb'):
    # Linux tar preserves AppleDouble metadata from macOS-created archives.
    if p.name.startswith('._'):continue
    if p.relative_to(root).parts[0] not in ['cm-type1','ps-fonts','lm-fonts']:continue
    font=T1Font(str(p));glyphs=font.getGlyphSet();encoding=font['Encoding'];paths={}
    for code,name in enumerate(encoding):
        if name not in glyphs or name=='.notdef':continue
        pen=SVGPathPen(glyphs);glyphs[name].draw(pen);paths[code]=pen.getCommands()
    (out/(p.stem+'.json')).write_text(json.dumps({'unitsPerEm':1000,'glyphs':paths},separators=(',',':')))
