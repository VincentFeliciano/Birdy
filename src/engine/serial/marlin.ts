// Marlin-style host protocol helpers for printing over USB. Pure, so they can be tested.

/** G-code lines worth sending: comments and blank lines removed. */
export function sendableLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const semi = raw.indexOf(';')
    const line = (semi >= 0 ? raw.slice(0, semi) : raw).trim()
    if (line) out.push(line)
  }
  return out
}

/** `N<n> <cmd>*<checksum>`: the checksum is the XOR of every byte before the `*`. */
export function numbered(n: number, cmd: string): string {
  const body = `N${n} ${cmd}`
  let cs = 0
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i) & 0xff
  return `${body}*${cs}`
}

export interface Temps {
  hotend?: number
  hotendTarget?: number
  bed?: number
  bedTarget?: number
}

export type Reply =
  | { kind: 'ok'; temps?: Temps }
  | { kind: 'resend'; line: number }
  | { kind: 'busy' }
  | { kind: 'error'; text: string }
  | { kind: 'temps'; temps: Temps }
  | { kind: 'start' }
  | { kind: 'other'; text: string }

export function parseTemps(line: string): Temps | undefined {
  const t: Temps = {}
  const h = /\bT0?:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/.exec(line)
  const b = /\bB:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/.exec(line)
  if (h) {
    t.hotend = Number(h[1])
    t.hotendTarget = Number(h[2])
  }
  if (b) {
    t.bed = Number(b[1])
    t.bedTarget = Number(b[2])
  }
  return h || b ? t : undefined
}

export function classify(raw: string): Reply {
  const line = raw.trim()
  const lower = line.toLowerCase()
  if (lower.startsWith('ok')) return { kind: 'ok', temps: parseTemps(line) }
  const rs = /^(?:resend|rs)[:\s]\s*N?(\d+)/i.exec(line)
  if (rs) return { kind: 'resend', line: Number(rs[1]) }
  if (lower.includes('busy:')) return { kind: 'busy' }
  if (lower === 'start' || lower.startsWith('start')) return { kind: 'start' }
  if (lower.startsWith('error') || lower.startsWith('!!')) return { kind: 'error', text: line }
  const temps = parseTemps(line)
  if (temps) return { kind: 'temps', temps }
  return { kind: 'other', text: line }
}

/** Errors Marlin follows with a resend request; anything else (e.g. a kill) is fatal. */
export function isRecoverableError(text: string): boolean {
  return /checksum|line number|no line number|format error|expected line/i.test(text)
}

/** Commands that make a stopped print safe: heaters and fan off, motors released. */
export const SAFE_STOP = ['M104 S0', 'M140 S0', 'M107', 'M84']
