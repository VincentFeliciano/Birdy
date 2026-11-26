export function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export const fmtNum = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—')
export const fmtInt = (n: number) => n.toLocaleString('en-US')
export const mmToIn = (mm: number) => mm / 25.4
