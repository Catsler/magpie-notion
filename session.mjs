// Signing in with the browser that is already signed in to Notion, the way
// other magpie plugins sign in with the client they belong to (Grok's
// ~/.grok/auth.json, kiro-cli's database, Cursor's keychain entry). A Notion
// web session lives in the browser's cookie store, so that is what this reads:
// the Chromium family's Cookies database and Firefox's cookies.sqlite.
//
// The store is copied before it is opened, because a running browser holds it
// open. Chromium encrypts the values. Windows protects the AES key with DPAPI
// (the key is in the profile's Local State), macOS and Linux keep it in the
// keychain. Chrome and Edge may write v20 values, which are bound to the
// application by the elevation service; those are reported, never guessed, so
// the caller can fall back to pasting the Cookie header.

import { spawn } from "node:child_process"
import { createDecipheriv, pbkdf2Sync } from "node:crypto"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, join } from "node:path"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The cookies a Notion web session is made of, by the domains the web client
// serves them from. token_v2 is the session; notion_user_id names the user.
// The client moved from notion.so to notion.com, and sets its session cookie on
// .app.notion.com, so a domain counts when it is one of these or below one of
// them: matching exact hosts alone would miss the cookie that matters.
const HOSTS = ["notion.so", "notion.com"]
const NAMES = ["token_v2", "notion_user_id", "notion_browser_id", "notion_check_cookie_consent", "notion_device_id", "notion_os"]
// A busy browser can take seconds to answer for its own cookies - a machine has
// been seen taking half a minute on the socket alone - so the read over a
// debugging port is given longer than a file that is already there.
const DEVTOOLS_TIMEOUT = 30_000
// A profile directory named in the environment is read before the desktop's
// own browsers: a container has no desktop profile, but an operator can put a
// Chromium profile where this build can reach it, and then that one is meant.
// Either name takes one directory or a list of them, separated the way the
// platform separates paths.
const PROFILE_ENV = ["NOTION_BROWSER_PROFILE", "MAGPIE_NOTION_BROWSER_PROFILE"]

// configuredRoots turns that environment into the stores' roots, most
// explicit first: each named directory is one profile directory, and a name
// repeated in both variables is used once.
export function configuredRoots(env) {
  const roots = []
  for (const name of PROFILE_ENV) {
    for (const part of String(env?.[name] ?? "").split(delimiter)) {
      const root = part.trim()
      if (root && !roots.some((entry) => entry.root === root)) roots.push({ browser: "Chromium", root })
    }
  }
  return roots
}

export class SessionError extends Error {
  constructor(message, reason) {
    super(message)
    this.name = "SessionError"
    this.reason = reason
  }
}

// notionHost says whether a cookie's domain belongs to Notion: the domain
// itself, or any subdomain of it. Cookies carry a leading dot for the
// subdomain form, which is not part of the comparison.
export function notionHost(domain) {
  const host = String(domain ?? "").toLowerCase().replace(/^\./, "")
  return HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

// browserStores lists every store on this machine that could hold a Notion
// session, most likely first: the browser the user signed in to Notion with is
// whichever one has the cookie, and the reading stops at the first that does.
export function browserStores(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const stores = []
  for (const { browser, root } of chromiumRoots(platform, env, home)) {
    if (!existsSync(root)) continue
    const localState = join(root, "Local State")
    let profiles = []
    let lastUsed
    try {
      const state = JSON.parse(readFileSync(localState, "utf8"))
      profiles = Object.keys(state?.profile?.info_cache ?? {})
      if (typeof state?.profile?.last_used === "string") lastUsed = state.profile.last_used
    } catch {
      profiles = []
    }
    if (!profiles.length) profiles = ["Default"]
    // The profile the browser last used is the one most likely to hold the
    // sign-in, and the information is already there for the taking.
    if (lastUsed && profiles.includes(lastUsed) && profiles[0] !== lastUsed) profiles = [lastUsed, ...profiles.filter((profile) => profile !== lastUsed)]
    for (const profile of profiles) {
      for (const relative of [["Network", "Cookies"], ["Cookies"]]) {
        const db = join(root, profile, ...relative)
        if (existsSync(db)) {
          stores.push({ kind: "chromium", browser, root, profile, db, localState })
          break
        }
      }
    }
    // A browser this build drives itself - a headless Chromium started with a
    // debugging port beside the container it serves - may have run long enough
    // to write its port before its store: the store is then read over that
    // port, so the profile still counts. This only adds a profile whose store
    // is not there at all.
    if (!stores.some((store) => store.root === root) && existsSync(join(root, "DevToolsActivePort"))) {
      stores.push({ kind: "chromium", browser, root, profile: "Default", db: undefined, localState })
    }
  }
  for (const { browser, root } of firefoxRoots(platform, env, home)) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const db = join(root, entry.name, "cookies.sqlite")
      if (entry.isDirectory() && existsSync(db)) stores.push({ kind: "firefox", browser, root, profile: entry.name, db })
    }
  }
  return stores
}

function chromiumRoots(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local")
    return [
      ...configuredRoots(env),
      { browser: "Chrome", root: join(local, "Google", "Chrome", "User Data") },
      { browser: "Edge", root: join(local, "Microsoft", "Edge", "User Data") },
      { browser: "Brave", root: join(local, "BraveSoftware", "Brave-Browser", "User Data") },
      { browser: "Chromium", root: join(local, "Chromium", "User Data") },
    ]
  }
  if (platform === "darwin") {
    const support = join(home, "Library", "Application Support")
    return [
      ...configuredRoots(env),
      { browser: "Chrome", root: join(support, "Google", "Chrome") },
      { browser: "Edge", root: join(support, "Microsoft Edge") },
      { browser: "Brave", root: join(support, "BraveSoftware", "Brave-Browser") },
      { browser: "Chromium", root: join(support, "Chromium") },
    ]
  }
  const config = env.XDG_CONFIG_HOME ?? join(home, ".config")
  return [
    ...configuredRoots(env),
    { browser: "Chrome", root: join(config, "google-chrome") },
    { browser: "Chromium", root: join(config, "chromium") },
    { browser: "Edge", root: join(config, "microsoft-edge") },
    { browser: "Brave", root: join(config, "BraveSoftware", "Brave-Browser") },
    // Flatpak and Snap keep their profiles outside the configuration directory.
    { browser: "Chrome", root: join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome") },
    { browser: "Brave", root: join(home, ".var", "app", "com.brave.Browser", "config", "BraveSoftware", "Brave-Browser") },
    { browser: "Chromium", root: join(home, "snap", "chromium", "current", ".config", "chromium") },
  ]
}

function firefoxRoots(platform, env, home) {
  if (platform === "win32") return [{ browser: "Firefox", root: join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Mozilla", "Firefox", "Profiles") }]
  if (platform === "darwin") return [{ browser: "Firefox", root: join(home, "Library", "Application Support", "Firefox", "Profiles") }]
  const config = env.XDG_CONFIG_HOME ?? join(home, ".config")
  return [
    { browser: "Firefox", root: join(home, ".mozilla", "firefox") },
    { browser: "Firefox", root: join(config, "mozilla", "firefox") },
  ]
}

// findSession reads every store until one holds a Notion session, and reports
// why each one that did not was left out: a locked store, an encryption this
// build cannot open, or a browser that was simply never signed in to Notion.
// A browser that is running can also be asked for its own cookies over the
// debugging port it names, which is the only way in when the store is locked or
// its values are bound to the browser.
export async function findSession(options = {}) {
  const stores = options.stores ?? browserStores(options)
  if (!stores.length) throw new SessionError("No Chrome, Edge, Brave, Chromium or Firefox profile was found on this machine. In a container, set NOTION_BROWSER_PROFILE to a Chromium profile directory, or sign in with the Notion web session (paste the Cookie header).", "no-browser")
  const problems = []
  for (const store of stores) {
    // A profile listed for its debugging port alone has no store to open; the
    // port is asked instead, below, and asking it is not this loop's job.
    if (!store.db) continue
    const where = `${store.browser} (${store.profile})`
    try {
      const cookies = await readStore(store, options)
      const best = bestCookies(cookies)
      const session = best.find((cookie) => cookie.name === "token_v2")
      if (!session) {
        problems.push(`${where} has no Notion session`)
        continue
      }
      const user = best.find((cookie) => cookie.name === "notion_user_id")
      return {
        cookie: cookieHeader(best),
        browser: store.browser,
        profile: store.profile,
        ...(UUID.test(user?.value ?? "") ? { activeUserId: user.value } : {}),
      }
    } catch (error) {
      problems.push(`${where}: ${error instanceof SessionError ? error.message : "could not be read"}`)
    }
  }
  try {
    const found = await findDevtoolsSession({ ...options, stores })
    if (found) return found
  } catch (error) {
    problems.push(error instanceof SessionError ? error.message : "the browser's debugging port could not be read")
  }
  throw new SessionError(problems.join("; "), "no-session")
}

// findDevtoolsSession asks a running Chromium for its own cookies, over the
// port the profile's DevToolsActivePort names. It reads, never writes, and only
// answers for a profile that has such a port; otherwise it says nothing.
export async function findDevtoolsSession(options = {}) {
  const stores = (options.stores ?? browserStores(options)).filter((store) => store.kind === "chromium")
  const problems = []
  const asked = new Set()
  for (const store of stores) {
    // One answer per browser: the port belongs to the profile the browser
    // opened first, and every other profile is read from its own store anyway.
    if (asked.has(store.root)) continue
    asked.add(store.root)
    const endpoint = devtoolsEndpoint(store)
    if (!endpoint) continue
    const named = stores.find((other) => other.root === store.root && other.profile === "Default") ?? store
    const where = `${named.browser} (${named.profile})`
    try {
      const cookies = (await (options.connect ?? connectDevtools)(endpoint, options.devtoolsTimeout ?? DEVTOOLS_TIMEOUT))
        .filter((cookie) => NAMES.includes(cookie?.name) && notionHost(cookie?.domain) && cookie.value)
      const best = bestCookies(cookies)
      if (!best.some((cookie) => cookie.name === "token_v2")) {
        problems.push(`${where} is signed in to no Notion account`)
        continue
      }
      const user = best.find((cookie) => cookie.name === "notion_user_id")
      return {
        cookie: cookieHeader(best),
        browser: named.browser,
        profile: named.profile,
        via: "devtools",
        ...(UUID.test(user?.value ?? "") ? { activeUserId: user.value } : {}),
      }
    } catch (error) {
      problems.push(`${where}: ${error instanceof SessionError ? error.message : "the browser's debugging port did not answer"}`)
    }
  }
  if (!problems.length) return undefined
  throw new SessionError(problems.join("; "), "no-session")
}

// devtoolsEndpoint is the address of a profile's DevTools server, which that
// profile writes down while it runs: the port on one line, the path on the next.
function devtoolsEndpoint(store) {
  try {
    const [port, path] = readFileSync(join(store.root, "DevToolsActivePort"), "utf8").split(/\r?\n/)
    if (!/^\d+$/.test(String(port).trim()) || !String(path ?? "").startsWith("/devtools/")) return undefined
    return `ws://127.0.0.1:${String(port).trim()}${String(path).trim()}`
  } catch {
    return undefined
  }
}

// connectDevtools asks the browser for every cookie it holds for the notion
// hosts. The reply is the browser's own answer, so the values are plain: no
// store, no key and no decryption are involved.
//
// A browser that has been sitting idle can take several seconds to answer on
// this port even though the socket opens at once, and an answer that never
// comes is not a refusal: the read is tried twice before the caller is told,
// so one slow moment does not read as "not signed in".
async function connectDevtools(endpoint, timeout) {
  let failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await askDevtools(endpoint, timeout)
    } catch (error) {
      failure = error
      if (error?.reason !== "devtools-timeout") break
    }
  }
  throw failure
}

function askDevtools(endpoint, timeout) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== "function") return reject(new SessionError("this runtime cannot open a browser's debugging port", "unsupported-runtime"))
    let socket
    try { socket = new WebSocket(endpoint) } catch { return reject(new SessionError("the browser's debugging port could not be opened", "devtools")) }
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close?.()
      value instanceof Error ? reject(value) : resolve(value)
    }
    const timer = setTimeout(() => finish(new SessionError("the browser's debugging port did not answer", "devtools-timeout")), timeout)
    socket.addEventListener("error", () => finish(new SessionError("the browser's debugging port refused the read", "devtools")))
    socket.addEventListener("message", (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message?.id !== 1) return
      if (message.error) finish(new SessionError(`the browser refused to name its cookies (${message.error.message})`, "devtools"))
      else finish(message.result?.cookies ?? [])
    })
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Storage.getCookies", params: {} })))
  })
}

// notionPriority ranks the domains a Notion cookie can come from. The web
// client's session lives on app.notion.com; cookie rows from the older
// notion.so site can still be beside it, and two values for one name must
// never both be sent, since nothing would say which one wins.
function notionPriority(host) {
  const value = String(host ?? "").toLowerCase().replace(/^\./, "")
  if (value === "app.notion.com") return 0
  if (value === "notion.com" || value.endsWith(".notion.com")) return 1
  return 2
}

// bestCookies keeps one cookie per name - the one from the domain closest to
// the web client - in the order the names were first found.
export function bestCookies(cookies) {
  const chosen = new Map()
  for (const cookie of cookies) {
    if (!cookie?.name || !cookie.value) continue
    const best = chosen.get(cookie.name)
    if (!best || notionPriority(cookie.host ?? cookie.domain) < notionPriority(best.host ?? best.domain)) chosen.set(cookie.name, cookie)
  }
  const emitted = new Set()
  const result = []
  for (const cookie of cookies) {
    if (!chosen.has(cookie?.name) || emitted.has(cookie.name)) continue
    emitted.add(cookie.name)
    result.push(chosen.get(cookie.name))
  }
  return result
}

// cookieHeader is the Cookie request header the web client would send: the
// Notion cookies the store holds, once per name, in the order they were found.
export function cookieHeader(cookies) {
  return bestCookies(cookies).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
}

async function readStore(store, options) {
  if (!store.db) throw new SessionError("this profile has no cookie store to read", "no-store")
  const copy = options.copyStore ?? copyToTemporary
  const temporary = copy(store)
  try {
    const database = await openDatabase(temporary.path, options)
    try {
      const rows = store.kind === "firefox" ? all(database, "SELECT name, value, host FROM moz_cookies WHERE host LIKE '%notion%' AND name IN ('token_v2','notion_user_id','notion_browser_id','notion_device_id','notion_os','notion_check_cookie_consent')") : all(database, "SELECT name, encrypted_value, host_key AS host FROM cookies WHERE host_key LIKE '%notion%' AND name IN ('token_v2','notion_user_id','notion_browser_id','notion_device_id','notion_os','notion_check_cookie_consent')")
      const key = store.kind === "firefox" || rows.every((row) => !row.encrypted_value) ? undefined : await valueKey(store, options)
      const cookies = []
      for (const row of rows) {
        if (!notionHost(row.host) || !NAMES.includes(row.name)) continue
        let value
        try {
          value = store.kind === "firefox" ? String(row.value ?? "") : decryptValue(toBuffer(row.encrypted_value), key, options)
        } catch (error) {
          // One row this build cannot open - a v20 value beside v10 ones - must
          // not throw away the rows that did open. Only the session itself is
          // allowed to fail the whole store.
          if (row.name === "token_v2") throw error
          continue
        }
        if (value) cookies.push({ name: row.name, value, host: row.host })
      }
      return cookies
    } finally {
      database.close?.()
    }
  } finally {
    if (temporary.remove) temporary.remove()
  }
}

// discard removes a copy the reader is done with. A browser, an indexer or an
// antivirus can hold a file for a moment longer; failing to take a copy back is
// never a reason for a sign-in to fail, so a failed attempt is retried in the
// background instead of leaving the session copy on disk for good.
function discard(directory) {
  const attempt = () => {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      return true
    } catch {
      return false
    }
  }
  if (attempt()) return true
  let tries = 0
  const retry = () => {
    if (attempt() || ++tries >= 10) return
    const timer = setTimeout(retry, 1000)
    timer.unref?.()
  }
  const timer = setTimeout(retry, 250)
  timer.unref?.()
  return false
}

function toBuffer(value) {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === "string") return Buffer.from(value, "latin1")
  return Buffer.alloc(0)
}

// copyToTemporary copies a store out of the browser's data directory. Windows
// browsers open the Cookies database so that nothing else may read it, which a
// running browser reports as EBUSY/EPERM; that is the one failure the caller
// can fix by closing the browser, so it gets its own words.
export function copyToTemporary(store, options = {}) {
  const copy = options.copyFile ?? copyFileSync
  const directory = mkdtempSync(join(tmpdir(), "magpie-notion-"))
  const path = join(directory, "cookies.db")
  try {
    copy(store.db, path)
  } catch (error) {
    discard(directory)
    const code = error?.code
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new SessionError(`${store.browser} is running and holds its cookie store open; close ${store.browser} and sign in again`, "locked")
    }
    throw new SessionError(error?.message ?? "the cookie store could not be copied", "unreadable")
  }
  return { path, remove: () => discard(directory) }
}

// A store is read with whichever SQLite the runtime has: Bun's Database
// answers query(), node:sqlite's DatabaseSync answers prepare(). Reading a
// store must not depend on being hosted by one of them.
function all(database, sql) {
  return typeof database.query === "function" ? database.query(sql).all() : database.prepare(sql).all()
}

export async function openDatabase(path, options = {}) {
  if (options.openDatabase) return options.openDatabase(path)
  try {
    const { Database } = await import("bun:sqlite")
    return new Database(path, { readonly: true })
  } catch (error) {
    try {
      const { DatabaseSync } = await import("node:sqlite")
      return new DatabaseSync(path, { readOnly: true })
    } catch {
      throw new SessionError(order(error), "unreadable")
    }
  }
}

function order(error) {
  return error?.message ? `the cookie store could not be opened: ${error.message}` : "the cookie store could not be opened"
}

// valueKey is the AES key the store's values were written with, taken from
// Local State (Windows) or from the desktop's keychain (macOS, Linux).
async function valueKey(store, options) {
  const platform = options.platform ?? process.platform
  const run = options.run ?? runFile
  let state = {}
  try {
    state = JSON.parse(readFileSync(store.localState, "utf8"))
  } catch {
    state = {}
  }
  if (platform === "win32") {
    const sealed = String(state?.os_crypt?.encrypted_key ?? "")
    if (!sealed) throw new SessionError("the profile's Local State holds no cookie key", "unsupported-encryption")
    const raw = Buffer.from(sealed, "base64")
    if (raw.subarray(0, 5).toString("latin1") !== "DPAPI") throw new SessionError("the profile's cookie key is not DPAPI", "unsupported-encryption")
    return dpapi(raw.subarray(5), run)
  }
  const secret = platform === "darwin" ? await keychainSecret(store, run) : await secretServiceKey(store, run)
  if (!secret) throw new SessionError("the desktop's keychain did not give up its cookie key", "unsupported-encryption")
  return { cipher: "cbc", key: pbkdf2Sync(secret, "saltysalt", platform === "darwin" ? 1003 : 1, 16, "sha1") }
}

async function dpapi(blob, run) {
  // The script is written to PowerShell's standard input. PowerShell's
  // command-line parsing is not involved, so nothing in it can be misread as
  // part of the script and the sealed key never reaches a command line.
  const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${blob.toString("base64")}'),$null,'CurrentUser'))`
  let out
  try {
    out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { input: script, windowsHide: true })
  } catch {
    throw new SessionError("Windows refused to unprotect the profile's cookie key", "unsupported-encryption")
  }
  const key = Buffer.from(String(out).trim(), "base64")
  if (key.length !== 32) throw new SessionError("the profile's cookie key is not 32 bytes", "unsupported-encryption")
  return { cipher: "gcm", key }
}

// The name each desktop files a browser's cookie key under: the product name in
// the macOS keychain, the package's application name for secret-tool on Linux.
// Neither is the browser's display name, and asking under the wrong one either
// finds nothing or finds another browser's key.
const SAFE_STORAGE = {
  Chrome: { darwin: "Chrome Safe Storage", linux: "chrome" },
  Chromium: { darwin: "Chromium Safe Storage", linux: "chromium" },
  Brave: { darwin: "Brave Safe Storage", linux: "brave" },
  Edge: { darwin: "Microsoft Edge Safe Storage", linux: "microsoft-edge" },
}

async function keychainSecret(store, run) {
  const service = SAFE_STORAGE[store.browser]?.darwin ?? `${store.browser} Safe Storage`
  try {
    return (await run("/usr/bin/security", ["find-generic-password", "-w", service])).trim()
  } catch {
    return ""
  }
}

async function secretServiceKey(store, run) {
  const application = SAFE_STORAGE[store.browser]?.linux ?? store.browser.toLowerCase()
  try {
    return (await run("secret-tool", ["lookup", "application", application])).trim()
  } catch {
    return ""
  }
}

// decryptValue opens one Chromium cookie value: "v10"/"v11" as Windows and the
// desktops write them, a bare DPAPI blob as Chrome wrote before v80, and
// nothing at all for the v20 app-bound values Chrome and Edge write now.
export function decryptValue(value, secret, options = {}) {
  const platform = options.platform ?? process.platform
  if (!value?.length) return ""
  const prefix = value.subarray(0, 3).toString("latin1")
  if (prefix === "v20") {
    throw new SessionError("this store's cookies are bound to the browser by the elevation service (v20), which needs administrator rights to open; paste the Cookie header instead", "unsupported-encryption")
  }
  if (!secret) throw new SessionError("the store's cookie key is missing", "unsupported-encryption")
  if (prefix === "v10" || prefix === "v11") {
    if (platform === "win32" || secret.cipher === "gcm") return gcm(value.subarray(3), secret.key)
    return cbc(value.subarray(3), secret.key)
  }
  // Chrome before v80 sealed each value with DPAPI on its own. Those builds
  // are years old; a value that is not marked with a version is reported, not
  // guessed at.
  throw new SessionError("the cookie value uses an encryption this build does not know", "unsupported-encryption")
}

function gcm(payload, key) {
  if (payload.length < 28) throw new SessionError("the cookie value is too short", "unsupported-encryption")
  const nonce = payload.subarray(0, 12)
  const tag = payload.subarray(payload.length - 16)
  const body = payload.subarray(12, payload.length - 16)
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")
  } catch {
    throw new SessionError("the cookie value could not be unsealed", "unsupported-encryption")
  }
}

function cbc(payload, key) {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "))
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8")
  } catch {
    throw new SessionError("the cookie value could not be unsealed", "unsupported-encryption")
  }
}

// runFile runs a helper program and hands it `input` on standard input where it
// takes one. Its output is the answer; a helper that ends unsuccessfully is a
// refusal, with nothing of what it printed of its own kept.
function runFile(file, args, options = {}) {
  const { input = "", ...rest } = options
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...rest, windowsHide: true })
    let out = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { out += chunk })
    child.stderr?.resume()
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${file} refused (${code})`))))
    child.stdin.on("error", () => {})
    child.stdin.end(input)
  })
}

export const _internal = { UUID, HOSTS, NAMES, notionHost, configuredRoots, chromiumRoots, firefoxRoots, readStore, valueKey, devtoolsEndpoint, connectDevtools, gcm, cbc, runFile, toBuffer, all }
