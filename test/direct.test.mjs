import { describe, expect, test } from "bun:test"

import { _internal, requestHead } from "../direct.mjs"

const URL_ = "https://app.notion.com/api/v3/createAgentThread"
const HEADERS = { "Content-Type": "application/json", "x-notion-space-id": "space", Cookie: "token_v2=live" }

// The edge answers a request whose Host is not the first header with
// "UserValidationError", so the order this function writes is the whole point
// of the module: a body and headers that are otherwise identical are accepted
// with Host first and refused with Host anywhere else.
describe("requestHead", () => {
  test("Host comes first, right after the request line", () => {
    const lines = requestHead(URL_, HEADERS, 12).split("\r\n")
    expect(lines[0]).toBe("POST /api/v3/createAgentThread HTTP/1.1")
    expect(lines[1]).toBe("Host: app.notion.com")
  })

  test("the caller's headers follow in its own order", () => {
    const lines = requestHead(URL_, HEADERS, 12).split("\r\n")
    expect(lines.slice(2, 5)).toEqual([
      "Content-Type: application/json",
      "x-notion-space-id: space",
      "Cookie: token_v2=live",
    ])
  })

  test("Content-Length is written once, last, from the body", () => {
    const head = requestHead(URL_, HEADERS, 436)
    expect(head.endsWith("Content-Length: 436\r\n\r\n")).toBe(true)
    expect(head.match(/content-length/gi)).toHaveLength(1)
  })

  test("a caller-supplied Host or Connection cannot reorder or duplicate it", () => {
    const head = requestHead(URL_, { Host: "elsewhere.example", Connection: "close", ...HEADERS }, 1)
    const lines = head.split("\r\n")
    expect(lines[1]).toBe("Host: app.notion.com")
    expect(lines.filter((line) => /^host:/i.test(line))).toHaveLength(1)
    expect(lines.some((line) => /^connection:/i.test(line))).toBe(false)
  })

  test("an absent header value is not written", () => {
    const head = requestHead(URL_, { ...HEADERS, "x-notion-active-user-header": undefined }, 1)
    expect(head).not.toContain("x-notion-active-user-header")
  })

  test("the path carries its query, so no endpoint is silently trimmed", () => {
    const lines = requestHead("https://app.notion.com/f/refresh?x=1", HEADERS, 0).split("\r\n")
    expect(lines[0]).toBe("POST /f/refresh?x=1 HTTP/1.1")
  })
})

describe("parseHead", () => {
  test("answers nothing until the header block is complete", () => {
    expect(_internal.parseHead(Buffer.from("HTTP/1.1 200 OK\r\ncontent-ty"))).toBeUndefined()
  })

  test("reads the status and lower-cased header names", () => {
    const head = _internal.parseHead(Buffer.from("HTTP/1.1 400 Bad Request\r\nContent-Length: 3\r\n\r\nabc"))
    expect(head.status).toBe(400)
    expect(head.headers["content-length"]).toBe("3")
    expect(head.rest.toString()).toBe("abc")
  })

  test("refuses a body that is not an HTTP answer", () => {
    expect(() => _internal.parseHead(Buffer.from("nonsense\r\n\r\n"))).toThrow()
  })
})

describe("decode", () => {
  test("waits for the whole Content-Length body", () => {
    expect(_internal.decode({ "content-length": "5" }, Buffer.from("abc"), false)).toEqual({ done: false })
    expect(_internal.decode({ "content-length": "5" }, Buffer.from("abcde"), false)).toEqual({ done: true, body: Buffer.from("abcde") })
  })

  test("stops at Content-Length even when more bytes follow", () => {
    const answer = _internal.decode({ "content-length": "2" }, Buffer.from("okextra"), false)
    expect(answer.done).toBe(true)
    expect(answer.body.toString()).toBe("ok")
  })

  test("reads a chunked body", () => {
    const answer = _internal.decode({ "transfer-encoding": "chunked" }, Buffer.from("3\r\nhel\r\n2\r\nlo\r\n0\r\n\r\n"), false)
    expect(answer.done).toBe(true)
    expect(answer.body.toString()).toBe("hello")
  })

  test("waits while a chunk is still missing", () => {
    expect(_internal.decode({ "transfer-encoding": "chunked" }, Buffer.from("3\r\nhel\r\n"), false)).toEqual({ done: false })
  })

  test("without a length, only the end of the connection finishes the body", () => {
    expect(_internal.decode({}, Buffer.from("abc"), false)).toEqual({ done: false })
    expect(_internal.decode({}, Buffer.from("abc"), true)).toEqual({ done: true, body: Buffer.from("abc") })
  })
})
