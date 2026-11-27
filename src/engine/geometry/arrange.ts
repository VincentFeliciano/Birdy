// Laying several models out on one plate.

/**
 * Shelf packing: footprints sorted by depth fill rows left to right up to `maxW`. Returns each
 * footprint's centre (from the layout's corner) and the layout's overall size.
 */
export function packRows(items: { w: number; d: number }[], maxW: number, gap: number) {
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.d - items[a]!.d || items[b]!.w - items[a]!.w)
  const places: { x: number; y: number }[] = new Array(items.length)
  let x = 0
  let y = 0
  let rowD = 0
  let width = 0
  for (const i of order) {
    const { w, d } = items[i]!
    if (x > 0 && x + w > maxW) {
      y += rowD + gap
      x = 0
      rowD = 0
    }
    places[i] = { x: x + w / 2, y: y + d / 2 }
    x += w + gap
    rowD = Math.max(rowD, d)
    width = Math.max(width, x - gap)
  }
  return { places, width, depth: y + rowD }
}
