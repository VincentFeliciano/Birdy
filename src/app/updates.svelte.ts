import type { UpdateState } from '../types/ipc'

// Update status from the main process, plus which offered version the user put off.
export const updates = $state({
  state: null as UpdateState | null,
  dismissed: localStorage.getItem('birdy.updateDismissed'),
  /** The user pressed "Check for updates", so "no update" and errors are worth showing. */
  manual: false,
  /** Strip closed during a download or with an update ready (it still installs when Boaty quits). */
  hidden: false,
})

export async function initUpdates() {
  window.api.updates.onState((s) => (updates.state = s))
  updates.state = await window.api.updates.get()
}

/** Show the bottom strip: an offer not yet put off, a download, a ready install, or a manual check's result. */
export function stripVisible(): boolean {
  const s = updates.state
  if (!s) return false
  if (s.status === 'downloading' || s.status === 'ready') return !updates.hidden
  if (s.status === 'available') return s.version !== updates.dismissed
  if (updates.manual) return s.status === 'checking' || s.status === 'none' || s.status === 'error'
  return false
}

export async function checkNow() {
  updates.manual = true
  updates.hidden = false
  updates.dismissed = null
  localStorage.removeItem('birdy.updateDismissed')
  await window.api.updates.check()
}

export function dismiss() {
  const s = updates.state
  if (s?.status === 'available' && s.version) {
    updates.dismissed = s.version
    localStorage.setItem('birdy.updateDismissed', s.version)
  }
  if (s?.status === 'downloading' || s?.status === 'ready') updates.hidden = true
  updates.manual = false
}
