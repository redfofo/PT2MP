# PT2MP

在 PT 站种子详情页识别影视信息，查看入库和订阅状态，并一键推送到 [MoviePilot](https://github.com/jxxghp/MoviePilot) 下载的用户脚本。

> 本项目是独立的社区脚本，不是 MoviePilot 或任何 PT 站点的官方项目。

## 功能

- 自动识别种子对应的影视信息，失败时可搜索或手动关联
- 显示已入库、部分入库、未入库状态
- 显示订阅状态，可直接订阅
- 一键把种子推送到 MoviePilot

## 兼容性

**MoviePilot：** V2、[moviepilot-neo](https://github.com/4Nest/moviepilot-neo)、V3

**站点模板：**

| 类型 | 站点 |
|---|---|
| 常规 NexusPHP | 详情页地址为 `details.php?id=` 等形式的站点 |
| 行序或结构不同的 NexusPHP | HDSky、青蛙、SpringSunday、KeepFrds |
| `movie_details` 模板 | HDWinG 等 |
| 自研站点 | M-Team、SunnyPT、TTG |

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 等用户脚本管理器。
2. 从 [Releases](https://github.com/redfofo/PT2MP/releases/latest) 打开最新版的 `pt2mp.user.js` 并确认安装。
3. 打开任意受支持的种子详情页，按提示填写 MoviePilot 地址和 API Key。

之后可在脚本管理器菜单中修改配置或开启调试日志。API Key 位于 MoviePilot 的“设定 → 系统 → 基础设置”。

## 权限与隐私

| 权限 | 用途 |
|---|---|
| `@match https://*/details.php?id=*` 等 | NexusPHP 站点域名无法穷举，因此按详情页路径匹配 |
| `@connect *` | MoviePilot 地址由用户填写，无法预先声明域名 |
| `GM_xmlhttpRequest` | 跨域请求 MoviePilot |
| `GM_getValue` / `GM_setValue` | 在本地保存配置 |

- 脚本不包含任何统计或上报代码，MoviePilot 相关请求只发往你配置的地址。
- 推送时，种子标题、副标题、大小、详情页地址和下载链接会发送给你的 MoviePilot。下载链接可能带有 passkey 等个人凭据。
- SunnyPT 需要读取当前登录会话的令牌，并且只用它向该站接口换取下载链接。
- 地址和 API Key 以明文保存在脚本管理器中。导出的备份会包含这些信息，请勿公开分享。

## 使用须知

- 使用前请确认所在站点的规则允许此类脚本。因使用脚本造成的账号或数据问题由使用者自行承担。
- 请不要在 Issue 中粘贴 passkey、API Key、Cookie 或未脱敏的网页文件。

## 反馈

请在 [Issues](https://github.com/redfofo/PT2MP/issues) 中说明站点模板、MoviePilot 版本、脚本版本，以及开启调试日志后的控制台输出（请先脱敏）。

## 开发与发布

克隆仓库后启用版本号检查。修改脚本但没有提高 `@version` 时，提交会被拦截：

```bash
git config core.hooksPath .githooks
```

推送到 `main` 不会发布新版本，发布步骤如下：

1. 提高 `pt2mp.user.js` 中的 `@version`，提交并推送。
2. 在 GitHub 发布 Release，tag 与版本号对应（如 `v1.0.1`），并附上 `pt2mp.user.js`。

发布后，Greasy Fork 通过 Webhook 同步，Release 标题会作为更新说明。

## 致谢与许可

本项目基于 yubanmeiqin9048 与 虚静道长 的 MIT 授权脚本重写。原始来源未能确认，如果您是原作者或知道原项目地址，请提交 Issue，我会补充链接。

本项目以 [MIT License](LICENSE) 发布。
