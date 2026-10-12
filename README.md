# ChatGPT Sol High Userscript

在 ChatGPT 空白新对话页自动选择 **GPT-5.6 Sol + High** 的 Tampermonkey 用户脚本。

A Tampermonkey userscript that selects GPT-5.6 Sol and exact High reasoning effort on empty new ChatGPT chats.

当前版本：**1.5.0**。发布脚本来自 `最终版本.txt`，保留原始代码。

## 安装

1. 在浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. **先停用旧版或其他自动选模型脚本**，避免多个脚本同时操作菜单。
3. 打开 [安装脚本](https://raw.githubusercontent.com/XingyuLin0/chatgpt-sol-high-userscript/main/chatgpt-5.6-sol-high.user.js)，核对代码后在 Tampermonkey 中安装。
4. 如果没有弹出安装界面，在 Tampermonkey 中新建脚本，把本仓库 `.user.js` 文件的全部内容粘贴进去并保存。
5. 打开 [ChatGPT](https://chatgpt.com/)，新建对话并等待菜单操作完成。发送消息前，确认页面中的模型和强度确实是 **GPT-5.6 Sol / High**。

需要账号的模型菜单本身提供这两个选项；脚本不会解锁账号没有的模型或功能。它依赖网页中实际可见的菜单结构，网页改版后可能需要适配。

## 功能与边界

- 仅匹配 `https://chatgpt.com/*`；自动流程限于 `/`、`/new` 和 `/g/<id>` 形式的空白页面。
- 当前按钮已经显示目标模型时，跳过重新选择模型的步骤。
- 精确匹配 High / 高，不将 Extra High、Max、Ultra 当作 High。
- 支持菜单选项、原生 range 和部分滑块界面的强度调整。
- 支持网页内导航，最多尝试三次。
- 用户开始输入、点击其他控件或操作模型菜单时，停止本次自动控制。
- 不自动发送消息；不调用额外的网络接口，不上传聊天内容，不写入浏览器存储；`@grant none`。
- 未配置远程自动更新地址。升级时重新安装并检查版本；保持只启用一份脚本。

1.5.0 使用减少菜单操作的快速流程，没有在结束时重新打开菜单进行模型和强度的独立双重核验。控制台“完成”日志表示脚本流程已完成；如果网页忽略模型点击，它不能保证模型真的切换成功，因此请核对实际选项。

## 排查问题

如果没有切换成功，先确认旧脚本已经停用、输入框为空、标签页可见，并且菜单提供精确的目标选项。点击“新建对话”可以再次触发。

开发者工具控制台的日志前缀为 `[ChatGPT 5.6 Sol High v1.5.0]`。反馈问题时可提供浏览器版本、脚本版本、菜单显示形式及相关日志；请先删除聊天内容、账号信息和凭据。

## 开发与验证

使用 Node.js 24，项目没有第三方运行或测试依赖，也不需要 `npm install`：

```sh
npm run check
npm test
```

9 项离线行为测试直接加载发布的 `.user.js` 文件。测试没有覆盖所有菜单分支，也不代表真实账号或所有网页菜单已经通过浏览器验收；已知限制见上方说明。

修改目标型号需要同步调整脚本中的匹配逻辑、版本和测试。当前版本没有用户设置面板。

## 许可证

[MIT](LICENSE)。本项目为独立社区脚本，与 OpenAI 没有官方关联。
