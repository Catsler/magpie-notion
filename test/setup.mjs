// Every suite answers from its own fetch. The plugin's own transport opens a
// socket to app.notion.com to write Host first, which is the one thing a suite
// must not do, so the suites read their mocked fetch through that same seam.
// A host runs the socket; only these tests replace it.
import { _internal as internals } from "../protocol.mjs"

internals.useTransport(internals.viaFetch)
