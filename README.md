# magpie-notion

版本：1.0.1

`magpie-notion` 是一个把 Notion AI 接入 Magpie / OpenCode 的非官方插件。它使用
Notion 网页客户端所调用的内部接口，不是 Notion 的公开 Integration API；Notion
更新网页端后，插件可能失效。

插件图标使用 Notion 官方黑白 N 方块标志，源文件保存在 `notion.svg`，
并内嵌到包元数据里。名称与标志属于 Notion；本项目是非官方插件。

## 安装

```sh
magpie plugin add github:resucdueff/magpie-notion
magpie plugin login notion
```

这个插件没有运行依赖，不需要 Magpie 安装原生模块。运行时 provider id 仍是
`notion`；插件列表中显示的名称是 `magpie-notion`。

## 登录

登录页有两个方式，优先用第一个。

### 1. 用本机浏览器里的 Notion 会话（推荐）

打开 https://www.notion.so/login；如果那个浏览器还没登录 Notion，先登录。之后
Magpie 会从本机的 Chrome、Edge、Brave、Chromium 或 Firefox 配置里读取这个会话，
不轮询浏览器，也不用粘贴任何东西。工作区 UUID 自动发现，不用填。

读不到时会说明是哪一种，并指向第二个方式：

- **权限不足**（macOS）：系统不允许 magpie 读取浏览器的数据目录。到「系统设置 ›
  隐私与安全性 › 完全磁盘访问权限」里给 magpie 打开，再登录一次。
- **钥匙串拒绝**：登录钥匙串没有交出浏览器用来加密 Cookie 的那把钥匙。这种情况
  即使给了完全磁盘访问权限也读不到，直接用第二个方式。
- **浏览器占用文件**：浏览器正开着并持有 Cookie 数据库。关掉那个浏览器再试。
- **本机没有登录 Notion 的浏览器**：换一台已登录的机器，或用第二个方式。

### 2. 粘贴 `token_v2`

只有一个输入框：

- 可以只粘贴 `token_v2` 的值。
- 也可以误贴整段含 `token_v2=` 的 Cookie；插件只提取 `token_v2`，不会使用其中
  的其他 Cookie。
- 空内容、找不到 `token_v2`、带换行的输入都会被拒绝。
- 登录失败时提示：`请粘贴 Notion 的 token_v2。`

两种方式都不需要填写工作区 UUID。插件会调用 `getSpaces` 自动发现账号可用的工作区，
再通过模型目录确认当前工作区。会话值只交给宿主自己的认证存储保存，不要
写进源码、命令参数、日志或提交记录。

### 获取 `token_v2`

`token_v2` 是 Notion 网页登录后保存在你自己浏览器里的会话值。只使用你自己的账号。

1. 用浏览器打开 https://www.notion.so 并登录，进入任意工作区。
2. 打开开发者工具。Windows 和 Linux 按 F12，macOS 按 Option-Command-I。
3. 选择「应用」或 Application，左侧展开 Cookie，点选 `https://www.notion.so`。
4. 找到名称正好是 `token_v2` 的一行，只复制它的值；不要复制名称，也不要复制整段 Cookie。
5. 回到 Magpie 的 Notion 登录页，把值粘贴进「粘贴 token_v2」。

如果没有「应用」面板，可以打开「网络」或 Network，刷新页面，点开任意一个发往
`www.notion.so` 的请求，在请求头 Cookie 中找到 `token_v2=`，复制等号后面、下一个
分号前面的内容。

这个值等同于登录状态。只粘贴到自己的 Magpie，不要发到聊天、工单或 Git 仓库。
失效后按同样的步骤重新复制。

复制时要整段选中。以 `v03:` 开头的值中间有好几段，用点号分开；少了最后一段时 Notion 会直接拒绝。会话被拒绝后，插件只能显示内置的一个占位模型，用量也是空的。请重新复制完整的 `token_v2`，不要把这个值发到聊天里。

每个账号同时发出的请求不限制。如果在 Magpie 里给 Notion 单独设了并发，以那个设置为准。

## 工具调用

插件不执行客户端附带的工具。Codex 等代理每次请求都会带上工具定义；这些定义会被去掉，对话仍按纯文本发给 Notion，并返回文字回答。

已经发生过的工具调用和工具结果会折成文字留在上下文里，Notion 不会再次执行它们。图片仍然拒绝。因此 Notion 模型可以正常对话，但不能替 Codex 运行 shell、改文件或调用其他工具。
