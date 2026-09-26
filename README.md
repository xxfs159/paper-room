# Paper Room · 论文阅读室

在线阅读 PDF 论文：按章节浏览原文、对照翻译、查看图表与公式，并就选中的段落或原文截图提问。

[打开网站](https://paper-reading-room.foxwellablin.chatgpt.site/)

## 功能

- 在浏览器内导入 PDF（最多 20 MB、100 页）或粘贴文本；阅读进度仅保留在当前页面。
- 按 PDF 提取的标题组织章节，同时保留原页码和原页画面。
- 逐节或全文翻译；划选原文时自动在旁边显示中文译文。
- 勾选段落或引用划选内容提问；「新对话」会清除旧问答、引用和待发送截图。
- 从原页框选公式，或上传截图提问。PDF 文字提取拆散的公式可查看原稿裁图。
- 连接 DeepSeek 或 OpenAI API；Key 只保存在当前页面内存，刷新后清除。请求经站点服务端转发到所选服务商。
- 使用 AI 前需要通过 ChatGPT 登录。模型输出可能出错，请对照原 PDF 核查。

## 本地运行

需要 Node.js 22.13 或更高版本及 pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

在开发环境打开终端显示的本地地址。部署版的登录依赖 Sites 提供的 ChatGPT 身份验证；本地开发使用项目内的模拟登录流程。无需把 API Key 写入仓库，直接在网页「连接 AI」输入。

```bash
pnpm exec tsc --noEmit
pnpm build
```

## 主要代码

- `app/reader.tsx`：论文阅读、PDF 渲染、章节导航、截图与交互
- `lib/paper.ts`：PDF 文本分段和章节识别
- `app/api/assist/route.ts`：模型请求、输入校验和回答引用校验
- `app/chatgpt-auth.ts`：站点登录辅助函数

PDF 文字提取无法保证公式和分栏完全正确；原页画面用于核对。示例论文为 *Attention Is All You Need*，原文归论文作者所有。
