import { createHash, randomUUID } from 'node:crypto'

/** RFC 7616 digest response (MD5, qop=auth), as PrusaLink requires for username logins. */
export function digestHeader(
  challenge: string,
  method: string,
  uri: string,
  user: string,
  pass: string,
  cnonce = randomUUID().replace(/-/g, ''),
  count = 1,
): string {
  const field = (k: string) => new RegExp(`${k}="?([^",]+)"?`, 'i').exec(challenge)?.[1] ?? ''
  const realm = field('realm')
  const nonce = field('nonce')
  const qop = field('qop').split(',')[0]?.trim()
  const opaque = field('opaque')
  const md5 = (s: string) => createHash('md5').update(s).digest('hex')
  const ha1 = md5(`${user}:${realm}:${pass}`)
  const ha2 = md5(`${method}:${uri}`)
  const nc = count.toString(16).padStart(8, '0')
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`)
  let h = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`
  if (opaque) h += `, opaque="${opaque}"`
  return h
}
