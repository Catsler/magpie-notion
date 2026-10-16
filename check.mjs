// Loads this package the way OpenCode and magpie do, then checks the shape of
// the hooks it returns and the metadata magpie reads from package.json. It
// signs in to nothing and sends no request.
import { existsSync, readFileSync } from "node:fs"

const here = new URL("./", import.meta.url)
const pkg = JSON.parse(readFileSync(new URL("package.json", here), "utf8"))
const problems = []
const note = (m) => problems.push(m)

// package.json: the parts magpie reads when listing and loading a plugin
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(String(pkg.version ?? ""))) note("version is not semver")
const haystack = [pkg.name, ...(pkg.keywords ?? [])].filter(Boolean).join(" ").toLowerCase()
if (!haystack.includes("opencode")) note("name and keywords do not mention opencode")
if (!/(auth|plugin|provider)/.test(haystack)) note("name and keywords hold none of auth, plugin, provider")
if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("magpie-plugin")) note("keywords should carry magpie-plugin")
const main = pkg.main ?? "index.mjs"
if (!existsSync(new URL(main, here))) note(`main ${main} is missing`)
if (!(pkg.files ?? []).includes(main.replace(/^\.\//, ""))) note(`files does not include ${main}`)
if (!existsSync(new URL("README.md", here))) note("README.md is missing")
const icon = pkg.magpie?.icon
if (typeof icon !== "string" || !/^(https:\/\/|data:image\/)/.test(icon)) note("magpie.icon is not an https: URL or a data:image/ URI")
else if (Buffer.byteLength(icon) > 1024 * 1024) note("magpie.icon is over 1 MB")
const concurrency = pkg.magpie?.maxConcurrency
if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1000)) {
  note("magpie.maxConcurrency should be a whole number from 1 to 1000")
}

// The plugin itself: one exported factory returning the hooks magpie expects
try {
  const mod = await import(new URL(main, here).href)
  const fns = Object.values(mod).filter((v) => typeof v === "function")
  if (!fns.length) note("exports no plugin function")
  const client = { app: { log: async () => {} }, auth: { set: async () => {} }, tui: { showToast: async () => {} }, config: { get: async () => ({ data: {} }) } }
  for (const fn of fns) {
    const hooks = await fn({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
    const auth = hooks?.auth
    if (!auth) {
      note(`${fn.name}: no auth hook`)
      continue
    }
    if (typeof auth.provider !== "string" || !auth.provider) note(`${fn.name}: auth.provider`)
    if (typeof auth.loader !== "function") note(`${fn.name}: auth.loader`)
    if (typeof auth.usage !== "function") note(`${fn.name}: auth.usage is the plan-usage hook`)
    if (!Array.isArray(auth.methods) || !auth.methods.length) note(`${fn.name}: auth.methods`)
    for (const m of auth.methods ?? []) {
      if (!["oauth", "api"].includes(m.type)) note(`${fn.name}: method type ${m.type}`)
      if (!m.label) note(`${fn.name}: a sign-in method has no label`)
      if (m.type === "oauth" && typeof m.authorize !== "function") note(`${fn.name}: ${m.label} has no authorize`)
    }
    if (!hooks.config) note(`${fn.name}: no config hook`)
    else {
      const cfg = { provider: {} }
      await hooks.config(cfg)
      const p = cfg.provider[auth.provider]
      if (!p) note(`${fn.name}: config does not declare ${auth.provider}`)
      else {
        if (!p.npm) note(`${fn.name}: ${auth.provider} has no npm`)
        if (!p.models || !Object.keys(p.models).length) note(`${fn.name}: ${auth.provider} has no models`)
      }
    }
    if (!hooks.provider?.models) note(`${fn.name}: no provider.models hook`)
  }
} catch (e) {
  note(String(e?.stack ?? e))
}

if (problems.length) {
  console.error(`failed ${pkg.name}\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log(`ok ${pkg.name} ${pkg.version}`)
