# Paper Room · 论文阅读室

在线阅读 PDF 论文：按章节浏览原文、对照翻译、查看图表与公式，并就选中的段落或原文截图提问。

[打开网站](https://paper-reading-room.foxwellablin.chatgpt.site/)

## 功能

- 在浏览器内导入 PDF（最多 20 MB、100 页）或粘贴文本；默认自动保存当前论文与阅读进度，刷新后恢复。
- 按 PDF 提取的标题组织章节，同时保留原页码和原页画面。
- 逐节或全文翻译；划选原文时自动在旁边显示中文译文。
- 勾选段落或引用划选内容提问；「新对话」会清除旧问答、引用和待发送截图，保留论文译文与术语表。
- 从原页框选公式，或上传截图提问。PDF 文字提取拆散的公式可查看原稿裁图。
- 连接 DeepSeek 或 OpenAI API；Key 只保存在当前页面内存，刷新后清除。请求经站点服务端转发到所选服务商。
- 使用 AI 前需要通过 ChatGPT 登录。模型输出可能出错，请对照原 PDF 核查。

## 本地阅读记录

阅读记录保存在当前设备、当前浏览器的本站 IndexedDB 中，不跨设备同步。保存内容包括当前论文的章节与物理页文本、原 PDF 文件、阅读位置与显示模式、译文、术语表、最近 2000 条问答和章节笔记。重新导入论文会更新当前保存的记录；刷新页面会自动恢复，无需再次选择原 PDF。

API Key、所选模型服务商、待发送截图及临时文件 URL 不保存；恢复后需要重新连接 AI。阅读区「本地保存」可以开关当前页面的自动保存，关闭后已有记录仍保留。「清除本地保存」会删除本机记录并关闭当前页面的自动保存，当前阅读内容仍可继续使用。浏览器清理站点数据也会删除记录；空间不足或浏览器不允许存储时，页面会提示保存失败。

## 本地运行

需要 Node.js 22.13 或更高版本及 pnpm 11；CI 使用 Node.js 24。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

在开发环境打开终端显示的本地地址。本地模拟登录只接受来自回环地址的 localhost 请求；部署版的登录依赖 Sites 提供的 ChatGPT 身份验证。无需把 API Key 写入仓库，直接在网页「连接 AI」输入。

PDF 渲染使用 PDF.js 的兼容构建。`pnpm dev` 和 `pnpm build` 会从已安装的同版本依赖生成静态 worker，避免版本不匹配或开发服务器把页面脚本注入 worker；生成文件不提交到 Git。

普通 checkout 不需要 `.openai/hosting.json`：缺失时不会配置 D1/R2 本地绑定，构建也不会生成虚构的部署元数据。使用 Sites 部署时，需由部署平台提供真实的 `.openai/hosting.json`；已有配置会原样复制到构建目录。损坏的配置会明确报错。当前阅读功能使用浏览器 IndexedDB，不使用服务端数据库；如果以后启用 D1/R2，须配置相应绑定。其他托管环境需要实现可信的身份验证，不能直接信任客户端提交的身份请求头。

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

CI 在每次 push 和 pull request 的干净 checkout 中执行这些检查。回归测试使用 Node.js 内置测试运行器；浏览器测试覆盖译文与术语恢复、清除保存和扫描页 OCR，模型响应使用模拟数据，无需模型服务或 API Key。

## 共享模型服务

用户可以在网页填写个人 OpenAI 或 DeepSeek API Key。若部署者希望提供共享 OpenAI 服务，须同时配置服务端密钥 `OPENAI_API_KEY` 和 Cloudflare Rate Limiting 绑定 `AI_RATE_LIMITER`。共享请求按已登录用户限流；缺少限流绑定时，共享服务关闭，用户仍可使用个人 Key。限流阈值由部署者在 Cloudflare 绑定中配置，密钥应通过部署平台的 secret 配置，不应写入仓库。

## 主要代码

- `app/reader.tsx`：论文阅读、PDF 渲染、章节导航、截图与交互
- `lib/paper.ts`：PDF 文本分段和章节识别
- `lib/reading-state.ts`：本地阅读记录校验、保存和恢复
- `lib/request-manager.ts`：AI 请求的统一取消与生命周期
- `app/api/assist/route.ts`：模型请求、输入校验和回答引用校验
- `app/chatgpt-auth.ts`：站点登录辅助函数

PDF 文字提取无法保证公式和分栏完全正确；原页画面用于核对。示例论文为 *Attention Is All You Need*，原文归论文作者所有。
