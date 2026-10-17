import { describe, expect, test } from "bun:test"

import { _internal } from "../protocol.mjs"

// Two things the edge checks at createAgentThread, and both were missing:
//  - Host must be the first header on the request line (direct.mjs writes it);
//  - the request must announce a browser, or the answer is "UserValidationError"
//    however valid the cookies and the body are. fetch() announces the runtime
//    (Bun/1.4, curl/8, nothing for node:https), so the agent is stated here.
describe("requestHeaders", () => {
  const account = { cookie: "token_v2=live", spaceId: "231546b1-eb2d-8176-a5ab-00035eb5210c", activeUserId: "22222222-2222-4222-8222-222222222222" }

  test("a browser user agent is stated, not left to the runtime", () => {
    const headers = _internal.requestHeaders(account)
    expect(headers["User-Agent"]).toBe(_internal.WEB_AGENT)
    expect(headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 /)
    expect(headers["User-Agent"]).toContain("Chrome/")
    expect(headers["User-Agent"]).not.toMatch(/^(Bun|curl|node)/)
  })

  test("the session and its workspace travel with it", () => {
    const headers = _internal.requestHeaders(account)
    // normalizeCookie keeps token_v2 first and appends the device and user
    // cookies the web client sends beside it.
    expect(headers.Cookie).toStartWith("token_v2=live")
    expect(headers.Cookie).toContain(account.activeUserId)
    expect(headers["x-notion-space-id"]).toBe(account.spaceId)
    expect(headers["x-notion-active-user-header"]).toBe(account.activeUserId)
    expect(headers.Origin).toBe("https://app.notion.com")
  })

  test("no workspace or user is written when the session names none", () => {
    const headers = _internal.requestHeaders({ cookie: "token_v2=live" })
    expect(headers["x-notion-space-id"]).toBeUndefined()
    expect(headers["x-notion-active-user-header"]).toBeUndefined()
  })
})
