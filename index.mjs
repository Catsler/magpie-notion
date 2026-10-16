import { createPlugin } from "./core.mjs"
import protocol from "./protocol.mjs"

export const NotionPlugin = async (_input, options) => createPlugin(protocol, options)
