# 词力 · 英语单词学习 PWA

纯前端英语生词管理应用：**拍照导入 → 记忆曲线复习（Boss 战）→ AI 口语陪练**。数据全部存在浏览器本地（IndexedDB），可安装到手机/电脑主屏，复习流程可离线运行。

- 视觉气质：Anki × 多邻国（专业卡片 + 游戏化坚持）
- 无自建后端、无数据库账号：唯一外部依赖是 DeepSeek API（可选 Cloudflare Worker 转发）

---

## 一、功能一览

| 板块 | 能力 |
|---|---|
| 拍照导入 | 拍照/选图/拖图 → vision 识别词条；**文档导入（Word .docx / PDF / Excel .xlsx / TXT，浏览器本地解析）**；**粘贴文本通道**（安卓本地 OCR 结果走文本模型）；确认列表（删误识别 / 标「已掌握」跳过）；本地去重 |
| 生词本 | CEFR×词性×主题 三维分组折叠；左滑 标熟/编辑/删除/回退；点读发音；搜索 |
| 今日学习 | streak 火焰 + 全勤周徽章；每日目标圆环 + 轻纸屑；Anki 3D 翻卡「先学」→ Boss 战「后考」；**到期词按每日目标分批练习（练完一批可继续下一批），翻完一批即算当日打卡** |
| Boss 战 | 选择题闯关；几何 SVG 小怪兽 + 三色血条；答对扣血飘伤害、答错回血加密排期；**答错当场展示正确释义+例句（可点读）**；答错词才批量 API 生成明日干扰项/例句，答对走本地抽词，全程离线可玩 |
| 听说 | 回合制语音对话（非实时流）：场景选择 → 到期词 ≤5 注入 prompt；按住/点按麦克风（无 ASR 环境自动提示打字）；目标词黄色高亮、中文翻译折叠、8 轮结算卡（命中数/口语小评/重听整场）；命中词当天 FSRS 加权 |
| 统计 | GitHub 热力日历、掌握率环形、**本月 API 花费估算**、**最近口语会话回看（小评 + 重听）** |
| 我的 | API Key / Worker 切换、**模型名覆盖（视觉/文本）**、**转发口令(可选)**、语音选择、每日目标、深色模式、**JSON 备份**、**云端一键同步（Worker+D1）** |

---

## 二、技术栈与记忆算法

- **前端**：Vite 8 + React 19（纯静态，无自建后端）
- **存储**：IndexedDB（Dexie 4），6 张表：`words / distractors / checkins / reviews / chat_sessions / usage`
- **记忆曲线**：ts-fsrs v5（本地计算，零 API）。单词排期存于 `words.fsrs`；答对=Good、答错=Again 自动调度（含 relearning steps）
- **设置**：localStorage（API Key、Worker 地址、语音、目标、深色模式等）

目录要点：

```
public/manifest.webmanifest  sw(构建时生成到 dist)  cf-worker.js(转发脚本)
scripts/gen-icons.mjs  gen-sw.mjs  smoke-*.mjs
src/config.js         ★模型名与官方计价表（唯一改价点）
src/db/              Dexie 建库 / fsrs 封装 / 领域仓储 repo.js
src/api/             client(OpenAI 兼容) usage(花费) ocr  distractors  chat
src/speech/          tts.js asr.js speechUtil.js（provider 接口，可替换）
src/components/      底部导航 / 导入向导 / 翻卡 / WordRow / BossBattle / 弹层…
src/pages/           Onboarding Today Library Speaking Stats Profile
src/styles/          tokens.css ★全部配色/动效变量（含深色模式） 组件样式就近
```

---

## 三、本地运行与测试

```bash
npm install
npm run dev        # http://localhost:5173 （已开 host:true，手机可走局域网 IP）
npm run smoke      # 数据层 / API 层 / OCR / Boss / 备份回环 冒烟测试（fake-indexeddb，免浏览器）
npm run build      # 产物 dist/（vite build + 自动生成含预缓存清单的 sw.js）
npm run preview    # 本地预览生产构建
npm run icons      # 重新生成 PWA 图标（零依赖 PNG 编码器）
```

> Windows 注意：PowerShell 默认禁止执行 `npm.ps1`，请用 `npm.cmd`（本仓库命令均以 `npm.cmd` 可跑通）。

**PWA 离线说明**：构建时 `scripts/gen-sw.mjs` 会把 `dist/assets` 的 hash 文件名写进预缓存；导航走网络优先、离线回退缓存页。部署新版本会生成新 hash，Service Worker 更新后自动接管。

---

## 四、构建与部署（Vercel / Netlify）

纯静态站点，两步：

1. `npm run build`
2. 把 `dist/` 目录部署到 Vercel（Framework Preset: Vite）或 Netlify（Publish directory: dist）。或推 GitHub 仓库后在两家平台 import 同一仓库，构建命令 `npm run build`、输出目录 `dist`。

> 注意：PWA 的 Service Worker 与 manifest 需要 **HTTPS**（localhost 例外），两家平台默认提供。

### 应用内配置
打开应用 → 首次引导或「我的 → API 设置」：
1. 填 DeepSeek **API Key**（只存本机 localStorage）；
2. 连接方式选 **Worker 转发** 并填你的 Worker 地址（推荐）——直连官方会被浏览器 CORS 拦截，一般不可用。

---

## 五、DeepSeek 转发（二选一）

### 方案 A：Cloudflare Worker（推荐，交付物含现成脚本）

1. 打开 <https://dash.cloudflare.com> → **Workers & Pages** → Create → Worker；
2. 把仓库根目录 **`cf-worker.js`** 的内容粘贴进去（Worker 名随意）；
3. Deploy 后得到 `https://<你的名称>.workers.dev` —— 填进应用设置即可。

脚本职责：OPTIONS 预检放行、把 `/chat/completions` POST 原样转发到 `api.deepseek.com`、补 CORS 头；同一份脚本还带 **可选 `CHAT_TOKEN` 校验**与 **`/sync` 云端同步（配 D1）**，见第十节。

### 方案 B：同站 Serverless 转发（Vercel 可选，同源无 CORS）

在仓库建以下两个文件，部署后把「Worker 地址」填为你的站点域名（如 `https://你的项目.vercel.app`），client 会 POST 到 `/chat/completions`，由 rewrite 转给 Edge Function：

```js
// api/chat/completions.mjs —— Vercel Edge Function（转发 /chat/completions）
export const config = { runtime: 'edge' }
const UP = 'https://api.deepseek.com/chat/completions'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const headers = new Headers(req.headers)
  headers.set('host', new URL(UP).host)
  headers.delete('origin')
  const up = await fetch(UP, { method: 'POST', headers, body: await req.arrayBuffer() })
  const out = new Response(up.body, up)
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v)
  return out
}
```

```jsonc
// vercel.json —— 把 /chat/completions 指到上面的函数
{ "rewrites": [{ "source": "/chat/completions", "destination": "/api/chat/completions" }] }
```

> Netlify 做法类似：函数 `netlify/functions/chat.mjs` + `_redirects` 里加 `"/chat/completions /.netlify/functions/chat 200"`。

---

## 六、模型与省 token（成本相关）

### 模型名（默认写死于 `src/config.js`，可在「我的 → API 设置」覆盖）
- 视觉 OCR/词条提取：`deepseek-v4-flash-vision-exp`
- 文本（归档/干扰项/口语/摘要/点评）：`deepseek-v4-flash`

> ⚠️ 模型名只是默认值；**账号里实际模型名不同时，在「我的 → API 设置」的「视觉模型/文本模型」框填真实名字并保存即可覆盖**（无需改代码）。若填的名字不存在会 404 → 应用提示「模型不可用」。视觉模型不可用/识别不到词时请用**粘贴文本**通道（本地 OCR → 文本模型），功能不中断。
> 拍照链路做了容错：模型输出夹带说明文字也能抠出 JSON；仍失败会自动让文本模型整理一次；再不行把原始返回贴出来提示你（不会默默丢词）。

### 内置的省 token 策略（均可在代码注释中找到）
1. 单词静态信息（释义/音标/CEFR/例句）随词条永久缓存 IndexedDB，同词永不重复请求；
2. 干扰项/例句只对**答错词**生成，且**一次请求批量**处理；答对词复习用本地随机抽词，零 API；
3. Prompt 全部精炼并设 `max_tokens` 上限（OCR 1800 / 干扰项按量 / 口语 200 / 摘要与点评 120）；
4. 口语上下文 ≤6 轮，超出先摘要压缩、只带最近 4 轮；
5. 每页/每处客户端先过滤乱码、去重，再花钱调 API。

### 花费估算方法
每条响应读取官方 `usage`（输入未命中/缓存命中/输出分开记）写入 `usage` 表；统计页按 `src/config.js` 的 **PRICING 计价表**（¥/百万 token：输入 ¥2、缓存命中 ¥0.5、输出 ¥8；vision 未公布前按同价占位）聚合估算，缓存命中按低价计。**官方调价只需改 `src/config.js` 一张表**，历史账单保留在 IndexedDB，可随 JSON 备份导出。

---

## 七、语音 / 平台兼容说明

- **ASR（识别）**：浏览器 Web Speech API —— Android Chrome 良好；**iOS Safari（含桌面 Firefox）不支持**，应用会自动提示用键盘输入，不会卡死；
- **TTS（朗读）**：浏览器 `speechSynthesis`，语音列表可在「我的 → 语音」里挑选试听；iOS 需在系统设置启用英文语音；
- 麦克风按住/点按两种模式可在「我的」切换；
- `src/speech/tts.js` 与 `asr.js` 是**可替换 provider 接口**（`supported/speak/start…`），日后想换云端 ASR/TTS 只改这两处。
- 尊重 `prefers-reduced-motion`（动画自动缩短），触控目标 ≥44px，深色模式跟随系统。

## 八、隐私与数据
- API Key、词库、打卡、对话、token 账单全部存**本机**（IndexedDB）；图片/文本仅在你配置的 Worker/直连地址发出；
- **云端同步（可选）**：数据仍以本机为准，「我的 → 云端同步」可把全量快照一键上传到你自己的 Worker+D1、或从云端拉取恢复 —— 手机/电脑互通就靠它（配置见第十节）；
- **iOS 清浏览器缓存会连本地数据一起清掉**：重要数据请养成「上传到云端」的习惯（或导出 JSON 备份）。

## 九、测试
`npm run smoke` 依次运行：数据层（导入/去重/评分/口语加权/打卡/streak）→ API 层（endpoint 切换/token 记账/花费数学/错误语义）→ 图片 OCR 纯函数（EXIF/缩放/归一化）→ Boss 选项构造 → 备份回环。测试基于 fake-indexeddb，不需要浏览器与网络。

## 十、出门随时用：托管上线 + 云同步 + 一键发布

### 架构：两个域名各司其职
| 角色 | 内容 | 填在哪里 |
|---|---|---|
| **站点托管**（本仓库构建产物） | 手机/电脑打开应用、装主屏、离线复习 | 浏览器地址栏 |
| **转发 + 同步 Worker**（`cf-worker.js`） | DeepSeek API 转发 + 云端同步 | 「我的 → API 设置 → Worker 地址」 |

> ⚠️ 两者别搞混：**别把页面托管域名填进 API 设置**（它不做转发）；API/云同步只走你配置的那个 Worker。

### A. 应用托管：GitHub + Cloudflare「Workers → 连接 Git」（当前采用，push 即自动部署）
1. 本仓库已关联 `github.com/<你的用户名>/wordpower`（分支 main）；
2. Cloudflare：Workers & Pages → 连接 Git 仓库（Workers Builds）→ 构建命令 `npm run build`、产物目录 `dist`；
3. 之后**每次 push 自动重建上线**，地址形如 `<项目名>.<账号号>.workers.dev`。
4. **日常发布 = 双击 `publish.bat`**（自动 git add/commit/push → 云端自动重建）；用户端打开新版本时底部浮「有新版本 → 刷新」。

备用托管：Cloudflare Pages / Vercel / Netlify（纯静态：`npm run build` 后传 `dist/`，或连 Git 自动构建，见第四/五节）。

### B. 转发 + 同步 Worker（一次性配置）
1. 把 `cf-worker.js`（已含 `/chat/completions` 转发 + `/sync/upload|download` 同步）全量粘贴进 Worker → Deploy；
2. Worker → Settings → **Bindings → D1 database**：新建库（如 `wordpower-sync`），绑定变量名 **`DB`**；
3. Settings → **Variables and Secrets**：
   - `SYNC_TOKEN`（Secret，云同步口令，必配）
   - `CHAT_TOKEN`（Secret，可选：设了则应用请求须带同串「转发口令」，防陌生人拿你的 Worker 当免费转发器）
4. 建表一次（Workers & Pages → D1 → 打开库 → Console）：
   `CREATE TABLE IF NOT EXISTS sync(id TEXT PRIMARY KEY, blob TEXT NOT NULL, updated_at INTEGER NOT NULL);`

### C. 每台设备首次使用
1. 打开站点地址 → 可先装到主屏（PWA）；
2. 「我的 → API 设置」：填 **Worker 地址**（转发 Worker 那个）；（要用 AI 功能再填 API Key；模型名与你账号不同时在「视觉模型/文本模型」里覆盖；Worker 设了 CHAT_TOKEN 则「转发口令」填一致）
3. 「我的 → 云端同步」：填 SYNC_TOKEN 口令 → **从云端拉取**词库。

### D. 日常使用流程（建议节奏）
1. **导入**：拍照/粘贴文本进词库（出门路上拍一页，回来自动整理好）；
2. **每天**：今日页按目标分批「翻卡先学 → Boss 后考」，翻完即打卡；答错当场看正确释义/例句，并自动加密排期、预生成明日题；
3. **开口**：听说板块选话题练约 8 轮，命中目标词当天 FSRS 加权；统计页可回看会话与点评；
4. **同步**：学完在「我的 → 云端同步」点一次**上传到云端**；换设备/出门前先上传、到另一台再拉取（全量快照、最后上传方覆盖）。

### E. 版本更新
日常：改代码 → 双击 `publish.bat`（push 后 Workers 自动重建）。手动路径：`npm run build`（或 build.bat）→ 按你的托管方式重传 `dist`。客户端刷新一次（或点「有新版本 → 刷新」浮条）即用新版。
