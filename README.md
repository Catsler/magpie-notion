# magpie-notion

版本：0.2.4

`magpie-notion` 是一个把 Notion AI 接入 Magpie / OpenCode 的非官方插件。它使用
Notion 网页客户端所调用的内部接口，不是 Notion 的公开 Integration API；Notion
更新网页端后，插件可能失效。

插件图标使用 Notion 官方黑白 N 方块标志，源文件保存在 otion.svg\，
并内嵌到包元数据里。名称与标志属于 Notion；本项目是非官方插件。

## 安装

```sh
magpie plugin add github:resucdueff/magpie-notion
magpie plugin login notion
```

Magpie 添加插件时会安装运行依赖。运行时 provider id 仍是 `notion`；插件列表中
显示的名称是 `magpie-notion`。

## 登录

登录只有一个输入框：粘贴你自己的 Notion `token_v2`。

- 可以只粘贴 `token_v2` 的值。
- 也可以误贴整段含 `token_v2=` 的 Cookie；插件只提取 `token_v2`，不会使用其中
  的其他 Cookie。
- 空内容、找不到 `token_v2`、带换行的输入都会被拒绝。
- 登录失败时提示：`请粘贴 Notion 的 token_v2。`
- 不打开网页，也不轮询浏览器。

登录不需要填写工作区 UUID。插件会调用 `getSpaces` 自动发现账号可用的工作区，
再通过模型目录确认当前工作区。`token_v2` 只交给宿主自己的认证存储保存，不要
写进源码、命令参数、日志或提交记录。

## 功能

- provider 名称为 `notion`，模型列表来自当前工作区的实时模型目录。
- 支持流式 SSE 和缓冲 JSON 两种聊天响应。
- `auth.usage` 会读取额度窗口；工作区提供 premium credits 时也会显示余额。
- 创建会话使用 `impit` 的 Chrome 客户端；模型目录、额度和转写使用普通 HTTP。
- 聊天不需要容器里运行浏览器。

## 限制

- 需要账号和工作区本身具备 Notion AI 权限。
- 当前只接受文本输入；图片和客户端工具调用会被拒绝。
- 工作区自动发现依赖当前 `token_v2` 对应的 Notion 会话。
- `token_v2` 失效后，需要重新登录并粘贴新的值。
- 插件不能保证 Notion 网页端内部接口长期稳定。
- Notion 自身的服务端工具可能仍然可用，因此不要把它当作隔离沙箱。
- 每次推理有总时限，默认 5 分钟；可通过插件选项 `timeoutMs` 调整。

## 自检

```sh
bun test
node check.mjs
node scripts/check-secrets.mjs
```
