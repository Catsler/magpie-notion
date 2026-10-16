# opencode-notion-auth

用你自己的 Notion 网页会话，把工作区里 Notion AI 的模型接到 magpie / OpenCode 上，
并在 `magpie quota` 里看到订阅额度的使用情况。

走的是 Notion 网页内部客户端 API，不是公开 Integration API。非官方插件，
Notion 改版后可能失效；开发跟踪
[magpie-community/plugins#118](https://github.com/magpie-community/plugins/issues/118)。

## 安装

```sh
magpie plugin add https://github.com/resucdueff/magpie_notion
magpie plugin login notion
```

登录方式：填入你本人 Notion 网页会话的完整 Cookie 请求头、工作区 UUID
（`spaceId`），浏览器里同时登录了多个 Notion 身份时再填 activeUserId。
Cookie 只由宿主自己的 auth 存储保存（Magpie 的 `plugin-auth.json` 或
OpenCode 的 auth store）；本插件不抓取、不续期、不外传。

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
- 会话过期后需要重新登录，目前没有自动提取或续期 Cookie。
- 上下文长度等限制未公开，按“未知”处理（显示为 0），不会编造数值。

## 自检

```sh
node check.mjs
bun test
```
