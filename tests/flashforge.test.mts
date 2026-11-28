import assert from 'node:assert/strict'
import { createServer as createHttp } from 'node:http'
import { createServer as createTcp, type AddressInfo } from 'node:net'
import { ffFields, ffFileName, ffHttpState, ffSend, ffStatus, ffTcpState, ffTemps, ffTest } from '../electron/flashforge.ts'

let n = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  n++
  console.log(`ok  ${name}`)
}

// ---- Parsing ----------------------------------------------------------------------------------

await test('reads M119 by line, not inside "MachineStatus"', () => {
  const f = ffFields('CMD M119 Received.\r\nEndstop: X-max: 110 Y-max: 110 Z-min: 0\r\nMachineStatus: BUILDING_FROM_SD\r\nMoveMode: MOVING\r\nStatus: S:1 L:0 J:0 F:0\r\nLED: 1\r\nCurrentFile: cube.gcode\r\nok\r\n')
  assert.equal(f.MachineStatus, 'BUILDING_FROM_SD')
  assert.equal(f.Status, 'S:1 L:0 J:0 F:0')
  assert.equal(f.CurrentFile, 'cube.gcode')
})

await test('temperatures in new and old firmware formats', () => {
  assert.deepEqual(ffTemps('T0:209.8/210.0 T1:0.0/0.0 B:59.5/60.0'), { hotend: 209.8, hotendTarget: 210, bed: 59.5, bedTarget: 60 })
  assert.deepEqual(ffTemps('T0:22 /0 B:11/0'), { hotend: 22, hotendTarget: 0, bed: 11, bedTarget: 0 })
})

await test('print states', () => {
  assert.equal(ffTcpState('READY'), 'idle')
  assert.equal(ffTcpState('BUILDING_FROM_SD', 'MOVING'), 'printing')
  assert.equal(ffTcpState('BUILDING_FROM_SD', 'PAUSED'), 'paused')
  assert.equal(ffTcpState('BUILDING_COMPLETED'), 'done')
  assert.equal(ffHttpState('ready'), 'idle')
  assert.equal(ffHttpState('printing'), 'printing')
  assert.equal(ffHttpState('pause'), 'paused')
  assert.equal(ffHttpState('completed'), 'done')
  assert.equal(ffHttpState('heating'), 'printing')
})

await test('file names the printer accepts', () => {
  assert.equal(ffFileName('My part (2).gcode'), 'My part _2_.gcode')
  assert.equal(ffFileName('cube'), 'cube.gcode')
  assert.equal(ffFileName('../x.gcode'), '_x.gcode')
})

// ---- A fake Adventurer 5M on HTTP --------------------------------------------------------------

const SN = 'SNMOMX9A01234'
const CODE = '3f9a0c1e'
let uploaded: { headers: Record<string, string | string[] | undefined>; body: Buffer } | null = null
let busy = false
const http = createHttp((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const send = (j: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(j)))
    if (req.url === '/uploadGcode') {
      if (req.headers.serialnumber !== SN || req.headers.checkcode !== CODE) return send({ code: 1, message: 'Access code is different' })
      uploaded = { headers: req.headers, body }
      return send({ code: 0, message: 'Success' })
    }
    const j = JSON.parse(body.toString() || '{}')
    if (j.serialNumber !== SN) return send({ code: 1, message: 'SN is different' })
    if (j.checkCode !== CODE) return send({ code: 1, message: 'Access code is different' })
    if (req.url === '/detail')
      return send({
        code: 0,
        message: 'Success',
        detail: busy
          ? { status: 'printing', printProgress: 0.42, printFileName: 'Benchy.gcode', printDuration: 600, estimatedTime: 900, rightTemp: 209, rightTargetTemp: 210, platTemp: 59, platTargetTemp: 60, name: 'Adventurer 5M Pro', firmwareVersion: '2.7.5', pid: '36' }
          : { status: 'ready', printProgress: 0, printDuration: 0, estimatedTime: 0, rightTemp: 25, rightTargetTemp: 0, platTemp: 24, platTargetTemp: 0, name: 'Adventurer 5M Pro', firmwareVersion: '2.7.5', pid: '36' },
      })
    send({ code: -1, message: 'Parameters is error' })
  })
})
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
const httpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
const five = { name: 'AD5M Pro', url: httpUrl, serial: SN, checkCode: CODE }

await test('5M: test connection names the printer', async () => {
  assert.match(await ffTest(five), /Adventurer 5M Pro.*2\.7\.5/)
})

await test('5M: a wrong check code is explained', async () => {
  await assert.rejects(ffTest({ ...five, checkCode: 'deadbeef' }), /serial number or check code/)
})

await test('5M: status while printing', async () => {
  busy = true
  const s = await ffStatus(five, 4000)
  assert.equal(s.state, 'printing')
  assert.equal(s.progress, 0.42)
  assert.equal(s.file, 'Benchy.gcode')
  assert.equal(s.elapsed, 600)
  assert.equal(s.remaining, 900)
  assert.equal(s.hotend, 209)
  assert.equal(s.bedTarget, 60)
})

await test('5M: refuses to start a print while busy', async () => {
  await assert.rejects(ffSend(five, 'cube.gcode', Buffer.from('G28\n'), true, 5000), /busy printing/)
  busy = false
})

await test('5M: upload sends the file with the login in headers', async () => {
  const data = Buffer.from(';FLAVOR:Marlin\nG28\nG1 X10 Y10\n')
  assert.equal(await ffSend(five, 'cube.gcode', data, true, 5000), 'cube.gcode')
  assert.ok(uploaded)
  assert.equal(uploaded.headers.filesize, String(data.length))
  assert.equal(uploaded.headers.printnow, 'true')
  assert.equal(uploaded.headers.levelingbeforeprint, 'true')
  assert.equal(uploaded.headers.materialmappings, undefined, 'AD5X-only headers are not sent to a 5M')
  const text = uploaded.body.toString('latin1')
  assert.match(text, /name="gcodeFile"; filename="cube.gcode"/)
  assert.ok(text.includes(data.toString()), 'file bytes are in the form')
})

// ---- A fake Adventurer 3 on TCP 8899 -----------------------------------------------------------

const files = new Map<string, Buffer>()
let started: string | null = null
let controlled = false
let otherHolds = false
const log: string[] = []
const tcp = createTcp((sock) => {
  let buf = Buffer.alloc(0)
  let receiving: { path: string; size: number; got: Buffer[]; n: number } | null = null
  sock.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (receiving) {
        const take = Math.min(buf.length, receiving.size - receiving.n)
        receiving.got.push(buf.subarray(0, take))
        receiving.n += take
        buf = buf.subarray(take)
        if (receiving.n < receiving.size) return
        files.set(receiving.path, Buffer.concat(receiving.got))
        receiving = null
        continue
      }
      const end = buf.indexOf('\r\n')
      if (end < 0) return
      const line = buf.subarray(0, end).toString()
      buf = buf.subarray(end + 2)
      assert.ok(line.startsWith('~'), `commands start with ~ (${line})`)
      const [cmd, ...parts] = line.slice(1).split(' ')
      const args = cmd === 'M28' ? [parts[0]!, parts.slice(1).join(' ')] : [parts.join(' ')]
      if (process.env.FFDEBUG) console.log('mock got', cmd, args)
      log.push(cmd!)
      const reply = (body: string) => sock.write(`CMD ${cmd} Received.\r\n${body}ok\r\n`)
      if (cmd === 'M601') {
        if (controlled || otherHolds) sock.write('CMD M601 Received.\r\nControl Failed.\r\n')
        else ((controlled = true), reply('Control Success V2.1.\r\n'))
      } else if (cmd === 'M602') ((controlled = false), reply('Control Release.\r\n'))
      else if (cmd === 'M115') reply('Machine Type: Flashforge Adventurer III\r\nMachine Name: Adventurer3\r\nFirmware: v1.3.7\r\nSN: SNADVA123\r\nX: 150 Y: 150 Z: 150\r\nTool Count: 1\r\n')
      else if (cmd === 'M119') reply(`Endstop: X-max: 0 Y-max: 0 Z-min: 0\r\nMachineStatus: ${started ? 'BUILDING_FROM_SD' : 'READY'}\r\nMoveMode: ${started ? 'MOVING' : 'READY'}\r\nStatus: S:1 L:0 J:0 F:0\r\nLED: 1\r\nCurrentFile: ${started ?? ''}\r\n`)
      else if (cmd === 'M105') reply('T0:200 /200 B:50/50\r\n')
      else if (cmd === 'M27') reply(started ? 'SD printing byte 30/100\r\n' : 'SD printing byte 0/100\r\n')
      else if (cmd === 'M28') {
        receiving = { size: Number(args[0]), path: args[1]!, got: [], n: 0 }
        reply('')
      } else if (cmd === 'M29') reply('')
      else if (cmd === 'M23') ((started = args[0]!.replace('0:/user/', '')), reply(''))
      else reply('')
    }
  })
  sock.on('close', () => (controlled = false))
})
await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r))
const adv3 = { name: 'Adventurer 3', url: `http://127.0.0.1:${(tcp.address() as AddressInfo).port}` }

await test('Adventurer 3: test connection over TCP', async () => {
  assert.match(await ffTest(adv3), /Adventurer3 \(firmware v1\.3\.7\)/)
  assert.deepEqual(log.splice(0), ['M601', 'M115', 'M602'], 'takes control, asks, and lets go')
})

await test('Adventurer 3: upload raw bytes and start the print', async () => {
  const data = Buffer.alloc(200_000, 0x47) // bigger than one write
  data.write(';gcode\n', 0)
  assert.equal(await ffSend(adv3, 'big part.gcode', data, true, 5000), 'big part.gcode')
  assert.deepEqual(files.get('0:/user/big part.gcode'), data)
  assert.equal(started, 'big part.gcode')
  assert.deepEqual(log.splice(0), ['M601', 'M28', 'M29', 'M23', 'M602'])
})

await test('Adventurer 3: status while printing', async () => {
  const s = await ffStatus(adv3, 4000)
  assert.equal(s.state, 'printing')
  assert.equal(s.progress, 0.3)
  assert.equal(s.file, 'big part.gcode')
  assert.equal(s.hotend, 200)
  assert.equal(s.bed, 50)
})

await test('Adventurer 3: another program in control is explained', async () => {
  otherHolds = true
  await assert.rejects(ffTest(adv3), /controlled by another program/)
  otherHolds = false
})

http.close()
tcp.close()
console.log(`${n} flashforge tests passed`)
process.exit(0)
