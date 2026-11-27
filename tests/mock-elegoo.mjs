// A local stand-in for an Elegoo resin printer speaking SDCP V3, for testing Birdy's Wi-Fi send.
// Usage: node tests/mock-elegoo.mjs <logFile> [httpPort]
// UDP 3000 (discovery) and HTTP/WebSocket on httpPort (default 3030), 127.0.0.1 only.
import { createHash, randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const logFile = process.argv[2] ?? 'mock-elegoo.log'
const httpPort = Number(process.argv[3] ?? 3030)
writeFileSync(logFile, '')
const log = (o) => appendFileSync(logFile, `${JSON.stringify(o)}\n`)

const MAINBOARD = '0a1b2c3d4e5f6789'
const files = new Map() // name -> Buffer
const uploads = new Map() // uuid -> { chunks: Buffer[], total, md5, name }
let print = null // { file, started, layers }

// --- discovery
const udp = createSocket('udp4')
udp.on('message', (msg, rinfo) => {
  log({ udp: msg.toString(), from: rinfo.address })
  if (msg.toString() !== 'M99999') return
  const reply = { Id: randomUUID(), Data: { Name: 'Saturn 4 Ultra', MachineName: 'ELEGOO Saturn 4 Ultra', BrandName: 'ELEGOO', MainboardIP: '127.0.0.1', MainboardID: MAINBOARD, ProtocolVersion: 'V3.0.0', FirmwareVersion: 'V1.2.3' } }
  udp.send(JSON.stringify(reply), rinfo.port, rinfo.address)
})
udp.bind(3000, '127.0.0.1')

// --- upload
function multipart(req, buf) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '')
  const boundary = `--${m[1] ?? m[2]}`
  const out = { fields: {}, file: null, filename: null }
  const bin = buf.toString('latin1')
  for (const part of bin.split(boundary).slice(1, -1)) {
    const at = part.indexOf('\r\n\r\n')
    const head = part.slice(0, at)
    const content = part.slice(at + 4, part.length - 2)
    const name = /name="([^"]+)"/.exec(head)?.[1]
    const filename = /filename="([^"]+)"/.exec(head)?.[1]
    if (filename) {
      out.file = Buffer.from(content, 'latin1')
      out.filename = filename
    } else if (name) out.fields[name] = content
  }
  return out
}

const reply = (res, ok, message) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(ok ? { code: '000000', messages: null, data: {}, success: true } : { code: '111111', messages: [{ field: 'common_field', message }], data: null, success: false }))
}

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/uploadFile/upload') {
      res.writeHead(404)
      return res.end()
    }
    const f = multipart(req, Buffer.concat(chunks))
    const { Uuid, Offset, TotalSize, Check } = f.fields
    const md5 = f.fields['S-File-MD5']
    let u = uploads.get(Uuid)
    if (!u) uploads.set(Uuid, (u = { chunks: [], got: 0, total: Number(TotalSize), md5, name: f.filename }))
    if (Number(Offset) !== u.got) {
      log({ upload: 'bad offset', Offset, got: u.got })
      return reply(res, false, 'offset mismatch (-2)')
    }
    u.chunks.push(f.file)
    u.got += f.file.length
    log({ upload: 'chunk', Offset: Number(Offset), size: f.file.length, total: u.total, name: f.filename })
    if (u.got >= u.total) {
      const all = Buffer.concat(u.chunks)
      const ok = Check !== '1' || createHash('md5').update(all).digest('hex') === u.md5
      log({ upload: 'done', name: u.name, bytes: all.length, md5ok: ok, tail: all.subarray(-11).toString('hex') })
      uploads.delete(Uuid)
      if (!ok) return reply(res, false, 'md5 mismatch')
      files.set(u.name, all)
    }
    reply(res, true)
  })
})

// --- WebSocket (just enough: text frames, masked from the client)
function frame(text) {
  const p = Buffer.from(text)
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255])
  return Buffer.concat([head, p])
}

function statusMsg() {
  let cur = 0
  let info = { Status: 0, CurrentLayer: 0, TotalLayer: 0, CurrentTicks: 0, TotalTicks: 0, Filename: '', ErrorNumber: 0, TaskId: '' }
  if (print) {
    const ms = Date.now() - print.started
    const total = print.layers * 3000
    const layer = Math.min(print.layers, Math.floor(ms / 3000) + 37)
    cur = 1
    info = { Status: 3, CurrentLayer: layer, TotalLayer: print.layers, CurrentTicks: layer * 3000, TotalTicks: total, Filename: print.file, ErrorNumber: 0, TaskId: 't1' }
  }
  return { Status: { CurrentStatus: [cur], PreviousStatus: 0, TempOfUVLED: 31.5, TempOfBox: 25.1, PrintInfo: info }, MainboardID: MAINBOARD, TimeStamp: Math.floor(Date.now() / 1000), Topic: `sdcp/status/${MAINBOARD}` }
}

server.on('upgrade', (req, socket) => {
  if (req.url !== '/websocket') return socket.destroy()
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  let buf = Buffer.alloc(0)
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    while (buf.length >= 2) {
      const op = buf[0] & 15
      let len = buf[1] & 127
      let off = 2
      if (len === 126) {
        len = buf.readUInt16BE(2)
        off = 4
      }
      const masked = buf[1] & 128
      const need = off + (masked ? 4 : 0) + len
      if (buf.length < need) return
      const mask = masked ? buf.subarray(off, off + 4) : null
      const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      buf = buf.subarray(need)
      if (op === 8) return socket.end()
      if (op !== 1) continue
      const text = payload.toString()
      if (text === 'ping') {
        socket.write(frame('pong'))
        continue
      }
      const m = JSON.parse(text)
      log({ ws: m.Data?.Cmd, data: m.Data?.Data, topic: m.Topic, mainboard: m.Data?.MainboardID })
      const respond = (data) =>
        socket.write(frame(JSON.stringify({ Id: m.Id, Data: { Cmd: m.Data.Cmd, Data: data, RequestID: m.Data.RequestID, MainboardID: MAINBOARD, TimeStamp: Math.floor(Date.now() / 1000) }, Topic: `sdcp/response/${MAINBOARD}` })))
      if (m.Topic !== `sdcp/request/${MAINBOARD}`) continue
      if (m.Data.Cmd === 0) {
        respond({ Ack: 0 })
        socket.write(frame(JSON.stringify(statusMsg())))
      } else if (m.Data.Cmd === 128) {
        const name = m.Data.Data.Filename
        if (!files.has(name)) respond({ Ack: 2 })
        else {
          print = { file: name, started: Date.now(), layers: 412 }
          respond({ Ack: 0 })
        }
      } else respond({ Ack: 0 })
    }
  })
  socket.on('error', () => {})
})
server.listen(httpPort, '127.0.0.1')
console.log(`mock Elegoo on 127.0.0.1 (udp 3000, http/ws ${httpPort})`)
