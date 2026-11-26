// Renders the Birdy neon logo to build/icon.png (512x512) for the Windows installer.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZE = 512
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <defs>
    <filter id="g" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="0.45" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="1" y="1" width="22" height="22" rx="6" fill="#0B0C0F"/>
  <g fill="none" stroke="#F5C400" stroke-linecap="round" stroke-linejoin="round" filter="url(#g)">
    <rect x="1.8" y="1.8" width="20.4" height="20.4" rx="5.2" stroke-width="0.6"/>
    <circle cx="11.2" cy="12.6" r="5.6" stroke-width="1.3"/>
    <path d="M16.7 11.3l2.9 1.3-2.9 1.3" stroke-width="1.3"/>
    <path d="M8.2 13.4c1 1.8 2.9 2.4 4.8 1.5" stroke-width="1.2"/>
    <path d="M10.6 7.1c.2-1.2 1-2 2.1-2.2" stroke-width="1.2"/>
    <path d="M7.5 19.6h8" stroke-width="1.2"/>
  </g>
  <circle cx="13.4" cy="11" r="0.95" fill="#F5C400" filter="url(#g)"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('wrote', out, img.getSize())
  app.quit()
})
