# magpie-notion

版本：0.2.4

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

