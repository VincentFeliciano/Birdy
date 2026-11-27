// Pure helper for the Birdy -> Boaty move (kept apart from Electron so it can be unit tested).

/**
 * Replaces the folder `from` with `to` where it starts a path in JSON text, written with escaped
 * backslashes or forward slashes, and only as a whole folder name (Birdy\, not "Birdy Models").
 */
export function replacePathPrefix(text: string, from: string, to: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = text
  for (const [f, t] of [
    [JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)],
    [from.replace(/\\/g, '/'), to.replace(/\\/g, '/')],
  ] as const) {
    out = out.replace(new RegExp(esc(f) + '(?=\\\\\\\\|/|")', 'gi'), t)
  }
  return out
}
