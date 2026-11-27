// Model pages on the big 3D-model sites, and how Birdy gets the files from each.

export type ModelSite = 'thingiverse' | 'printables' | 'makerworld' | 'cults3d' | 'myminifactory' | 'thangs'

export interface ModelPage {
  site: ModelSite
  siteName: string
  id: string
  /** The page that lists the files, when the site has one and it is not this page. */
  files: string | null
  /** What to tell the user: the sites only hand out files from their own Download buttons. */
  hint: string
}

/** Recognises a model page from its URL; null for anything else. */
export function modelPage(raw: string): ModelPage | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()

  if (host === 'www.thingiverse.com' || host === 'thingiverse.com') {
    const m = /^\/thing:(\d{1,12})(\/[a-z-]*)?\/?$/i.exec(u.pathname)
    if (!m) return null
    const onFiles = (m[2] ?? '').toLowerCase() === '/files'
    return {
      site: 'thingiverse',
      siteName: 'Thingiverse',
      id: m[1]!,
      files: onFiles ? null : `https://www.thingiverse.com/thing:${m[1]}/files`,
      hint: 'Press "Download all files" (or Download on a single file). Birdy unpacks ZIPs into your Models folder and opens the model as soon as it arrives.',
    }
  }

  if (host === 'www.printables.com' || host === 'printables.com') {
    const m = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/model\/(\d{1,12})(-[a-z0-9-]{0,200})?(\/[a-z-]*)?\/?$/i.exec(u.pathname)
    if (!m) return null
    const base = `https://www.printables.com/model/${m[1]}${m[2] ?? ''}`
    const onFiles = (m[3] ?? '').toLowerCase() === '/files'
    return {
      site: 'printables',
      siteName: 'Printables',
      id: m[1]!,
      files: onFiles ? null : `${base}/files`,
      hint: 'Press Download on a file, or "Download all model files". Birdy opens it as soon as it arrives.',
    }
  }

  if (host === 'makerworld.com' || host === 'www.makerworld.com') {
    const m = /^(?:\/[a-z]{2}(?:-[a-z]{2,4})?)?\/models\/(\d{1,12})(?:[-/][^?#]*)?$/i.exec(u.pathname)
    if (!m) return null
    return {
      site: 'makerworld',
      siteName: 'MakerWorld',
      id: m[1]!,
      files: null,
      hint: 'Press "Download STL/CAD files" or "Download 3MF" on the page (MakerWorld needs you signed in). Birdy opens it as soon as it arrives.',
    }
  }

  if (host === 'cults3d.com' || host === 'www.cults3d.com') {
    const m = /^\/[a-z]{2}\/(?:3d-model|modele-3d|modelo-3d|3d-modell|modello-3d)\/[a-z0-9-]{1,80}\/([a-z0-9-]{1,200})\/?$/i.exec(u.pathname)
    if (!m) return null
    return {
      site: 'cults3d',
      siteName: 'Cults3D',
      id: m[1]!.toLowerCase(),
      files: null,
      hint: 'Press Download on the page (Cults3D needs you signed in, and paid models must be bought first). Birdy opens it as soon as it arrives.',
    }
  }

  if (host === 'www.myminifactory.com' || host === 'myminifactory.com') {
    const m = /^(?:\/[a-z]{2})?\/object\/[a-z0-9-]{0,200}?-?(\d{1,12})\/?$/i.exec(u.pathname)
    if (!m) return null
    return {
      site: 'myminifactory',
      siteName: 'MyMiniFactory',
      id: m[1]!,
      files: null,
      hint: 'Press Download on the page (MyMiniFactory needs you signed in). Birdy unpacks ZIPs into your Models folder and opens the model as soon as it arrives.',
    }
  }

  if (host === 'thangs.com' || host === 'www.thangs.com') {
    const m = /^\/(?:designer\/[^/]{1,80}\/3d-model\/[^/]{0,200}?-?(\d{1,12})|m\/(\d{1,12}))\/?$/i.exec(u.pathname)
    if (!m) return null
    return {
      site: 'thangs',
      siteName: 'Thangs',
      id: (m[1] ?? m[2])!,
      files: null,
      hint: 'Press Download on the page (Thangs needs you signed in). Birdy opens it as soon as it arrives.',
    }
  }
  return null
}
