// Birdy was renamed Boaty. The app's data folder (%APPDATA%\Birdy: settings, printers and their
// encrypted secrets, the slicing engine) and the workspace (Documents\Birdy: models, library,
// exports) move to the new name once, the first time Boaty starts. Paths saved inside the data
// folder are pointed at the new workspace. When a move can't happen (the old app still running, a
// file in use), the old folder simply stays in use: nothing is copied half-way or lost.
import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { replacePathPrefix } from './path-prefix'

export const OLD_NAME = 'Birdy'
export const NEW_NAME = 'Boaty'

/** Moves %APPDATA%\Birdy to %APPDATA%\Boaty. Call after app.setName, before anything uses userData. */
export function migrateUserData() {
  // Test runs that pass their own data folder are left alone.
  if (app.commandLine.hasSwitch('user-data-dir')) return
  const appData = app.getPath('appData')
  const from = join(appData, OLD_NAME)
  const to = join(appData, NEW_NAME)
  if (existsSync(to) || !existsSync(from)) return
  try {
    renameSync(from, to)
    app.setPath('userData', to)
  } catch {
    // Still locked (the old app open?): keep using the old folder; the move is tried next start.
    app.setPath('userData', from)
  }
}

/**
 * The workspace root in Documents: Boaty, or the old Birdy folder moved there. Returns the old
 * folder when it exists and can't be moved yet.
 */
export function workspaceRoot(documents: string): string {
  const from = join(documents, OLD_NAME)
  const to = join(documents, NEW_NAME)
  if (existsSync(to) || !existsSync(from)) return to
  try {
    renameSync(from, to)
  } catch {
    return from
  }
  repointSavedPaths(from, to)
  return to
}

/** Rewrites paths under `from` to `to` in the JSON files kept in the data folder. */
export function repointSavedPaths(from: string, to: string) {
  const dir = app.getPath('userData')
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json'))
  } catch {
    return
  }
  for (const name of names) {
    const file = join(dir, name)
    try {
      const text = readFileSync(file, 'utf8')
      const next = replacePathPrefix(text, from, to)
      if (next !== text) writeFileSync(file, next)
    } catch {
      /* a file we can't read or write keeps its old paths */
    }
  }
}
