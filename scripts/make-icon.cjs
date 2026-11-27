// Renders the Boaty neon logo (src/assets/boaty-logo.png) to build/icon.png (512x512) for the
// Windows installer and app icon: the boat glowing mustard yellow on a dark rounded tile.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZE = 512
const ACCENT = '245, 196, 0' // mustard yellow, the default neon colour
const logo = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'boaty-logo.png')).toString('base64')

const html = `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; background: transparent; overflow: hidden; }
  .tile {
    position: absolute; inset: 14px; border-radius: 112px;
    background: radial-gradient(circle at 50% 40%, #17181d, #0b0c0f 70%);
    box-shadow: inset 0 0 0 14px rgb(${ACCENT}), inset 0 0 34px 14px rgba(${ACCENT}, .35);
  }
  .glow {
    position: absolute; left: 50%; top: 52%; height: 300px; aspect-ratio: 512 / 458; transform: translate(-50%, -50%);
    filter: drop-shadow(0 0 4px rgba(${ACCENT}, 1)) drop-shadow(0 0 16px rgba(${ACCENT}, .6)) drop-shadow(0 0 38px rgba(${ACCENT}, .3));
  }
  .bird {
    width: 100%; height: 100%;
    background: radial-gradient(circle at 60% 40%, rgb(255, 226, 110), rgb(${ACCENT}) 70%);
    -webkit-mask: url(data:image/png;base64,${logo}) center / contain no-repeat;
  }
</style></head><body><div class="tile"></div><div class="glow"><div class="bird"></div></div></body></html>`

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
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 600))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('wrote', out, img.getSize())
  app.quit()
})
