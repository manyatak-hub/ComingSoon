// Converts a TTF into the three.js typeface JSON format (like facetype.js).
// usage: node tools/make-font.cjs <in.ttf> <out.json> [chars]
const opentype = require('opentype.js')
const fs = require('fs')
const [, , inFile, outFile, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '] = process.argv
const font = opentype.loadSync(inFile)
const scale = (1000 * 100) / ((font.unitsPerEm || 2048) * 72)
const r = (n) => Math.round(n * scale)
const glyphs = {}
for (const ch of chars) {
  const g = font.charToGlyph(ch)
  const o = []
  g.path.commands.forEach((c) => {
    const t = c.type.toLowerCase()
    if (t === 'z') return
    o.push(t === 'c' ? 'b' : t)
    o.push(r(c.x), r(c.y))
    if (t === 'q') o.push(r(c.x1), r(c.y1))
    if (t === 'c') o.push(r(c.x1), r(c.y1), r(c.x2), r(c.y2))
  })
  const bb = g.getBoundingBox()
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(bb.x1), x_max: r(bb.x2), o: o.join(' ') }
}
fs.writeFileSync(outFile, JSON.stringify({
  glyphs,
  familyName: font.names.fontFamily.en,
  ascender: r(font.ascender),
  descender: r(font.descender),
  underlinePosition: r(font.tables.post.underlinePosition),
  underlineThickness: r(font.tables.post.underlineThickness),
  boundingBox: { xMin: r(font.tables.head.xMin), xMax: r(font.tables.head.xMax), yMin: r(font.tables.head.yMin), yMax: r(font.tables.head.yMax) },
  resolution: 1000,
  original_font_information: font.tables.name,
}))
console.log('wrote', outFile, Object.keys(glyphs).length, 'glyphs')
