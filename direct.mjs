import { connect } from "node:tls"

// Notion's edge reads the request line and then requires Host to be the first
// header after it. A request whose every other byte is identical is answered
// with "UserValidationError" when Host comes later, which is exactly where
// fetch() and node:https put it. createAgentThread is the endpoint that checks
// this, so a fetch there fails whatever the body and cookies say.
//
// So this writes the request itself, with Host first, and reads an ordinary
// HTTP/1.1 answer. Everything else about the exchange stays what fetch would
// have sent: the same headers, the same bytes, no Accept-Encoding, so the body
// arrives uncompressed.
const MAX_HEAD = 64 * 1024
const MAX_BODY = 8 * 1024 * 1024
const DEFAULT_TIMEOUT = 60_000

// requestHead is the request line and headers, in the order the edge wants:
// Host, then the caller's headers in the order it gave them, then the length.
export function requestHead(url, headers, length) {
  const target = new URL(url)
  const lines = [`POST ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.host}`]
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue
    const lower = name.toLowerCase()
    if (lower === "host" || lower === "content-length" || lower === "connection") continue
    lines.push(`${name}: ${value}`)
  }
  lines.push(`Content-Length: ${length}`, "", "")
  return lines.join("\r\n")
}

function abortReason(signal) {
  const error = new Error("The request was aborted.")
  error.name = "AbortError"
  error.cause = signal?.reason
  return error
}

// decode turns the bytes after the headers into the body, reading chunked
// framing when the edge chose it and stopping at Content-Length otherwise.
function decode(headers, buffer, ended) {
  const chunked = /chunked/i.test(headers["transfer-encoding"] ?? "")
  if (!chunked) {
    const length = Number(headers["content-length"])
    if (Number.isFinite(length)) return buffer.length >= length ? { body: buffer.subarray(0, length), done: true } : { done: false }
    return ended ? { body: buffer, done: true } : { done: false }
  }
  const parts = []
  let offset = 0
  for (;;) {
    const eol = buffer.indexOf("\r\n", offset)
    if (eol < 0) return { done: false }
    const size = parseInt(buffer.subarray(offset, eol).toString("latin1").split(";")[0].trim(), 16)
    if (!Number.isFinite(size)) return { done: false }
    if (size === 0) return { body: Buffer.concat(parts), done: true }
    const start = eol + 2
    if (buffer.length < start + size + 2) return { done: false }
    parts.push(buffer.subarray(start, start + size))
    offset = start + size + 2
  }
}

function parseHead(buffer) {
  const end = buffer.indexOf("\r\n\r\n")
  if (end < 0) return undefined
  if (end > MAX_HEAD) throw new Error("The response headers were too long.")
  const lines = buffer.subarray(0, end).toString("latin1").split("\r\n")
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(lines[0])
  if (!match) throw new Error("Notion answered with no HTTP status.")
  const headers = {}
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return { status: Number(match[1]), headers, rest: buffer.subarray(end + 4) }
}

// exchange posts a JSON body over its own TLS socket and answers with the
// status and the body text. A transport failure rejects, so the caller can
// fall back to fetch where this connection cannot be made at all (a proxy the
// host routes through, a network that forbids direct TLS).
export function exchange(url, headers, body, options = {}) {
  const target = new URL(url)
  const payload = Buffer.from(body ?? "", "utf8")
  const head = requestHead(url, headers, payload.length)
  const signal = options.signal
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const port = Number(target.port || 443)
  const servername = options.servername ?? target.hostname

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal))
    const socket = connect({ host: target.hostname, port, servername, ALPNProtocols: ["http/1.1"] })
    let head_ = undefined
    let received = Buffer.alloc(0)
    let settled = false

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
      signal?.removeEventListener?.("abort", onAbort)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const done = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const advance = (ended) => {
      if (!head_) {
        head_ = parseHead(received)
        if (!head_) {
          if (received.length > MAX_HEAD) return fail(new Error("The response headers were too long."))
          return ended ? fail(new Error("Notion closed the connection before answering.")) : undefined
        }
        if (head_.status >= 300 && head_.status < 400) return fail(new Error("Notion redirected the request."))
      }
      const decoded = decode(head_.headers, head_.rest, ended)
      if (!decoded.done) return undefined
      if (decoded.body.length > MAX_BODY) return fail(new Error("The response was too large."))
      return done({ status: head_.status, text: decoded.body.toString("utf8"), headers: head_.headers })
    }
    function onAbort() { fail(abortReason(signal)) }

    signal?.addEventListener?.("abort", onAbort, { once: true })
    socket.setTimeout(timeout, () => fail(new Error("Notion did not answer in time.")))
    socket.on("error", fail)
    socket.on("secureConnect", () => {
      socket.write(head)
      socket.write(payload)
    })
    socket.on("data", (chunk) => {
      if (!head_) {
        received = Buffer.concat([received, chunk])
        return advance(false)
      }
      received = Buffer.concat([head_.rest, chunk])
      head_ = { ...head_, rest: received }
      return advance(false)
    })
    socket.on("end", () => {
      if (settled) return
      advance(true)
      if (!settled) fail(new Error("Notion closed the connection before the response was complete."))
    })
  })
}

export const _internal = { decode, parseHead }
