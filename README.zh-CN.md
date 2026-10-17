# opencode-notion-auth

用你自己的 Notion 网页会话，把工作区里 Notion AI 的模型接到 magpie / OpenCode 上，
并在 `magpie quota` 里看到订阅额度的使用情况。

走的是 Notion 网页内部客户端 API，不是公开 Integration API。非官方插件，
Notion 改版后可能失效；开发跟踪
[magpie-community/plugins#118](https://github.com/magpie-community/plugins/issues/118)。

插件图标使用 Notion 官方黑白 N 方块标志，源文件保存在 `notion.svg`，
并内嵌到包元数据里。名称与标志属于 Notion；本项目是非官方插件。

## 安装

```sh
magpie plugin add https://github.com/resucdueff/magpie-notion
magpie plugin login notion
```

Magpie 添加插件时会安装它的运行依赖，不依赖安装脚本；聊天在 Docker 里也不需要浏览器。

登录有两种方式，都不需要你填工作区 UUID：

- **直接用本机浏览器里已登录的 Notion 会话**（默认方式）。插件会按
  Chrome、Edge、Brave、Chromium、Firefox 的顺序去找本机的 cookie 库，
  先复制再打开，不会干扰正在运行的浏览器。Windows 用 user data 目录里
  `Local State` 的 DPAPI 密钥解密，macOS 走钥匙串，Linux 走 `secret-tool`；
  没有可用钥匙串值时再试 Chromium 基础存储的固定口令；
  `v20`（app-bound）这类解不开的值会如实报错，不会瞎猜。库读不动时
  （浏览器占着文件，或值是 app-bound），再问正在运行的 Chromium：
  读它 user data 目录里的 `DevToolsActivePort`，用一次本地 WebSocket 只读地问
  它自己的 cookie。走这条路要求浏览器是带调试端口启动的
  （`--remote-debugging-port`，`--remote-debugging-pipe` 不开放端口）。
  请求密集时，同一个浏览器最多每分钟问一次；一旦请求返回 401，这个复用立刻
  作废、下次重新读。没有可用会话时，Magpie 会打开 `NOTION_SIGNIN_URL`；
  没设它时打开 `MAGPIE_WEB_URL` 下的 `notion-login/` 页面，并每两秒检查一次，
  最多等三分钟。
- **手动粘贴 Cookie 请求头**：给本插件读不了的浏览器用。填你本人 Notion
  网页会话的完整 Cookie 请求头，`spaceId`、activeUserId 都可留空。

登录仍会读取本机浏览器，或接受粘贴的 Cookie；读取只用于拿到会话。登录后，
聊天不要求用户的浏览器继续开着，Docker 里也不需要浏览器。只有创建线程使用
已安装的 impit Chrome 客户端；模型目录、额度和转录流仍走普通 HTTP，不需要
用户的浏览器，也不需要在 Docker 里运行浏览器。

### Docker 登录

点登录按钮会打开 `MAGPIE_WEB_URL` 下的 `notion-login/` 页面（或显式设置的
`NOTION_SIGNIN_URL`），随后轮询到登录完成。把页面所用 Chromium 的 user data
目录持久化到卷，并用 `NOTION_BROWSER_PROFILE` 或
`MAGPIE_NOTION_BROWSER_PROFILE` 指向它，容器就能读到同一个持续保留的配置。
`spaceId` 会从登录后的会话自动发现，不需要在登录表单里填写。两个地址都没配置时，
按钮会返回可读的读取失败，不会编造公网地址。

如果登录要从浏览器配置里读取而不是粘贴 Cookie，没有桌面浏览器的容器或服务器
可以把事先准备好（或登录一次后保留下来）的 Chromium **user data 目录**指给
插件：设 `NOTION_BROWSER_PROFILE` 或 `MAGPIE_NOTION_BROWSER_PROFILE`，各接受
一个或多个这样的目录，多个用当前平台的路径分隔符分隔（Windows 分号，macOS 与
Linux 冒号）。这里指的是 user data 目录本身，也就是 `--user-data-dir` 指向的
那个目录：`Local State` 和（浏览器运行时才有的）`DevToolsActivePort` 都在它的
根上，具体的 profile（`Default`、`Profile 1`……）在它下面，各自的 cookie 库
位于 `Network/Cookies`（或 `Cookies`）。这些目录会排在系统默认的 Chrome、Edge、
Brave、Chromium 位置之前优先读取，两个变量里重复出现的同一目录只读一次。目录里
只有 `DevToolsActivePort` 时，则改走该调试端口读取。注意：只挂载这个 user data
目录本身，不要挂载整个用户目录；旁车容器在另一台主机时，可以在
`DevToolsActivePort` 旁写一个 `DevToolsHost`。调试端口不要暴露到不受信任的网络。

工作区（`spaceId`）是自动发现的：先问会话有哪些 space，再逐个用
`getAvailableModels` 探测，第一个能答的就是当前工作区，那份模型表也就直接
用上了，并按会话缓存 30 分钟。你也可以显式填一个 UUID，插件会在发请求前
校验格式。

Cookie 只由宿主自己的 auth 存储保存（Magpie 的 `plugin-auth.json` 或
OpenCode 的 auth store）；本插件不外传、不续期——会话过期就在浏览器里重新登录
一次，插件下次会自动读到。

## 提供什么

- provider 名 `notion`；模型列表实时取自工作区的 `getAvailableModels`，
  没有写死的模型表，工作区看不到的模型也不会被放进来。
- `auth.usage`：`magpie quota` 显示订阅窗口用量与 premium 积分余额。
- 流式输出，SSE 与缓冲 JSON 两种上游形式都支持。

## 限制

- 需要真正的 Notion Business（或更高）工作区并且开通 Notion AI；
  没有 AI 计划、额度耗尽会报相应错误。
- 图片输入与客户端函数/工具调用被拒绝；Notion 自身的服务端工具可能仍然
  可用，因此不要把它当作隔离沙箱使用。
- 会话过期后请在浏览器里重新登录；插件不代你续期，但会重新读取本机会话。
- 额度响应完全读不出窗口时会报错，不会显示成空账号；正式回答比已流出的临时
  文本短时以正式回答为准（SSE 已发出的部分无法撤回），整轮没有文本则报错。
- 上下文长度等限制未公开，按“未知”处理（显示为 0），不会编造数值。
- 每次推理总时长默认 5 分钟（`timeoutMs`）；从浏览器读到的会话默认复用
  60 秒（`browserReadMs`，设 0 表示每次都读）。

## 自检

```sh
node check.mjs
bun test
```
