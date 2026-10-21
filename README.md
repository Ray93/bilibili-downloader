# Bilibili Downloader

`fluxdown@bilibili-downloader` 是一个 FluxDown 插件：从 Bilibili 番剧页面读取分集列表，为每一集解析 DASH 视频与音频地址，交给 FluxDown 下载引擎合并；同时提供 UP 主投稿订阅、二维码登录与状态面板。

本项目 fork 自 [gulanthys/FluxDown-plugin](https://github.com/gulanthys/FluxDown-plugin) 并在此基础上重写扩展。

## 功能

- 支持番剧播放页 `/bangumi/play/ss...`、`/bangumi/play/ep...`，媒体页 `/bangumi/media/md...`，以及移动端（`m.bilibili.com`）同款链接
- 支持普通投稿视频链接 `/video/BV...` 与 `/video/av...`（含 `m.bilibili.com`）：多P视频逐个分P列出，`?p=N` 只解析该分P
- 自动发现正片分集；可选发现番外、预告、PV、采访等分区
- DASH 画质选择：最佳、2160p、1440p、1080p、720p、480p，并支持仅下载音频（M4A）
- 每个可用画质生成独立清单条目，文件名追加画质标签（例如 `[1080p-高清]`）
- 优先选择高质量音频轨，视频与音频交给 FluxDown 合并；播放地址标记为临时直链
- Cookie 支持浏览器 Cookie 头与 Netscape `cookies.txt`，导入后规范化缓存复用
- 二维码登录（FD 认证入口）与登录态复用，可在状态面板注销
- 番剧订阅 provider `bilibili-bangumi`，以及 UP 主空间投稿订阅（最新 20 条）
- activity 栏状态面板：登录状态、注销、解析设置快捷修改

## 系统要求

- FluxDown `0.1.64` 或更高版本（`manifest.json` 的 `minAppVersion`）
- 可访问 `api.bilibili.com`；登录需要 `passport.bilibili.com`，WBI 签名需要 `i0.hdslb.com`
- 需要登录权限的内容必须提供有效的 Bilibili Cookie
- DASH 音视频合并需要在 FluxDown 组件设置中安装或配置 FFmpeg

## 安装

### 从安装包安装

1. 打开 FluxDown 的「设置 → 扩展 → 插件」。
2. 点击「通过 ZIP 安装」，选择 `fluxdown@bilibili-downloader-{0.3.0}.fxplug`（部分客户端只显示 `.zip`，把扩展名改成 `.zip` 即可，不要先解压）。
3. 安装成功后确认插件已启用。

插件包根目录必须直接包含 `manifest.json`、`main.js`、`resolve.js`、`auth.js`。

### 开发目录安装

1. 执行 `pnpm install && pnpm build`，生成 `dist/`。
2. 在「设置 → 扩展 → 插件」中选择「从目录安装」，指向本项目的 `dist/`。
3. 执行 `pnpm dev`，保存源码后自动重建 `dist/`；修改 `manifest.json` 后需要在插件行上点击「Reload」。

## 配置

插件卡片设置中可以配置：

| 设置                 | 说明                                                   | 默认值   |
| -------------------- | ------------------------------------------------------ | -------- |
| 导入 Bilibili Cookie | 支持浏览器 Cookie 请求头或 Netscape `cookies.txt` 内容 | 空       |
| 复用已保存登录态     | 没有显式 Cookie 时复用插件缓存的登录态                 | 开启     |
| 包含番外与花絮       | 同时列出番外、预告、PV、采访等分区                     | 关闭     |
| 优先最高画质         | 每集只展示最高可用画质，避免长番剧条数超限             | 关闭     |
| 默认画质             | 无人值守或选择超时时使用的画质                         | 最佳画质 |

Cookie 只应从自己的浏览器登录态导出；不要提交到 Git 仓库或分享给他人。

## 状态面板

activity 栏的「Bilibili Downloader」视图显示：

- 当前登录状态与已保存的认证档案数量，可刷新状态、注销登录；
- 解析设置（包含番外、优先最高画质、复用登录态、默认画质），修改后与插件设置卡片同步。

二维码登录本身由插件卡片的「认证/登录」发起，面板只负责展示和清理登录态。

## 登录

1. 在插件卡片中点击「认证/登录」；
2. 插件申请二维码交给 FD 客户端展示；
3. 使用 Bilibili App 扫码并确认，插件在同一会话中自动轮询；
4. 成功后 FD 保存 `SESSDATA` 等认证 Cookie，后续解析自动复用；
5. 需要退出时点击「注销」，或使用状态面板的「注销登录」。

## 使用

1. 复制 Bilibili 番剧播放页/媒体页，或普通投稿视频的 `/video/` 链接，交给 FluxDown 创建任务。
2. 插件返回分集或分P清单（每一项可能有多个画质条目）。
3. 选择需要的条目与画质；未手动选择时使用「默认画质」。
4. FluxDown 逐条获取短期播放地址并下载，番剧番外分区会放入对应子目录。

## 解析流程

插件分两阶段工作：

1. 链接 → 清单：
   - 番剧链接：调用番剧接口，读取正片及可选附加分区的分集，为每集探测可用画质，返回扁平清单；
   - `/video/BV...`、`/video/av...`：用 view 接口把 av 号归一成 bvid，读取分P列表，为每个分P探测可用画质；链接带 `?p=N` 时只列该分P，否则列出全部（最多 100 个分P，仅前 24 个分P探测画质）。
2. 清单条目 → 临时直链：番剧用 `ep:<id>@q:<qualityId>`，投稿视频用 `video:<bvid>:cid:<cid>@q:<qualityId>`，调用播放接口获取该画质的 DASH 视频/音频直链，再交回 FluxDown 下载与合并。

插件本身不做后台轮询，也不主动创建任务；订阅轮询、去重、过滤和建任务由 FluxDown 核心负责。

## 订阅

### 番剧订阅

在 RSS/订阅向导中把来源选为「Bilibili 番剧 · bilibili-bangumi」，地址填写播放页、媒体页或单集页，例如：

```text
https://www.bilibili.com/bangumi/play/ss12345
```

每轮读取分集列表并按可用画质生成独立条目，标题显示实际画质（例如 `[720p 高清]`）。订阅使用插件的 Cookie 与「包含番外与花絮」设置；「默认画质」只影响普通链接解析，订阅会返回全部可用画质（受「优先最高画质」限制）。单轮最多处理最近 50 集。

筛选设置中可按标题过滤画质，例如包含 `1080p|720p`、排除 `HDR`。若希望同一集保留多个画质，不要开启「智能剧集去重」。

### UP 主投稿订阅

地址填写 UP 主空间，例如 `https://space.bilibili.com/123456`。每轮读取最新 20 条普通投稿，为每条选择最高可用画质，按 `bvid + cid + 画质` 生成稳定条目；投稿列表使用 WBI 签名接口，插件会缓存并在签名失效时刷新 key。直播回放、合集订阅不在范围内。

播放地址是短期直链，长时间暂停后再启动任务可能需要重新刷新订阅或重试。

## 常见问题

**安装窗口看不到 `.fxplug`**：把扩展名改成 `.zip` 后再选择，不要解压或重复压缩。

**解析失败**：依次检查 FluxDown 版本是否 ≥ 0.1.64、插件是否启用、链接是否为番剧页面或 `/video/BV...`、`/video/av...` 视频页（`b23.tv` 短链、合集页不支持）、Cookie 是否有效、能否访问 `api.bilibili.com`。

**只能看到部分画质**：接口返回的画质取决于账号权限与视频本身；默认画质不会提升账号没有的权限。

**清单里的文件大小准确吗**：DASH 的播放接口不返回文件大小，插件用 `bandwidth × 时长 / 8` 估算（实测与 CDN `Content-Length` 相差不到 0.1%）；带 `size` 字段的接口（如 FLV/durl）直接用真实值。

**下载地址很快失效**：直链是临时的，建议解析后尽快开始下载；失败可重新解析或重试任务。

## 源码结构

运行时入口由 `fluxdown-plugin.config.json` 声明，源码在 `src/`：

- `src/main.tsx`：activity 视图（登录状态与解析设置面板）
- `src/resolve.ts`：`defineResolver` + `defineSubscription`，分发番剧/分集/UP 主三类入口
- `src/auth.ts`：`defineAuth` 二维码登录入口
- `src/host.ts`：`PluginHost` 接口与 `flux` 适配（设置读取、storage JSON、日志）
- `src/bilibili/shared/`：常量、接口类型、文本工具、条目 id、命名、MD5
- `src/bilibili/http/`：API 客户端、Cookie 处理、WBI 签名
- `src/bilibili/media/`：画质变体与选择、分集发现与命名、season 定位、视频 view 与分P命名
- `src/bilibili/bangumi/`：番剧两段式解析与番剧订阅
- `src/bilibili/video/`：普通投稿视频链接（`/video/BV...`、`/video/av...`）→ 分P×画质清单
- `src/bilibili/uploader/`：UP 主投稿列表、二段解析（分集/投稿直链）与投稿订阅
- `src/bilibili/subscribe.ts`：订阅 provider 分发（番剧 / UP 主）
- `src/auth/session.ts`：登录会话、认证档案保存/状态/注销
- `src/tests/`：vitest 单元测试与 fake host

命令：

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # 打包 dist/ 并做严格清单校验
pnpm validate      # 仅校验现有 dist/
pnpm run pack      # 生成 .fxplug
pnpm dev           # 监听重建
```

## 来源与许可

- **来源**：本项目 fork 自 [gulanthys/FluxDown-plugin](https://github.com/gulanthys/FluxDown-plugin)，该仓库是本插件的起点。此后本项目对解析与订阅逻辑做了重构与扩展，源码结构与上游已有明显差异。
- **上游许可**：上游仓库目前未提供许可文件，因此本项目不复制、也不代表任何上游许可条款，同样不代表上游对本文档所述改动的认可或背书。
- **本仓库许可**：本项目自身代码以 MIT 协议发布，全文见 [LICENSE](LICENSE)。可自由使用、修改与再分发，但需在副本或实质性部分中保留版权与许可声明。

## 安全说明

- Cookie 是用户机密：只写入插件 storage 与 FD 认证档案，不写日志、不写清单、不进仓库。
- 诊断日志只记录布尔状态与画质信息，不包含 Cookie 值。
- 不要提交从浏览器导出的 `cookies.txt`。
