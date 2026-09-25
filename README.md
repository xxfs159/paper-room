# Paper Room · 论文阅读室

上传 PDF 或粘贴论文原文，按章节阅读、对照翻译、查看原页图表，并选段提问。支持在页面中输入 DeepSeek 或 OpenAI API Key。密钥只保留在当前页面内存中，刷新后清除；网站向所选模型服务转发请求。

在线体验：[Paper Room](https://paper-reading-room.foxwellablin.chatgpt.site)

## 本地运行

需要 Node.js >= 22.13 和 pnpm 11。项目基于 Vinext / Cloudflare Workers。

```bash
corepack enable
pnpm install
pnpm dev
```

本地开发可打开终端给出的地址。服务端 API 使用 Cloudflare Workers 运行时。正式部署版本通过 ChatGPT Sites 提供登录身份：`app/api/assist/route.ts` 调用 `getChatGPTUser()`，直接改用其他托管平台时需要实现对应的登录验证与部署配置。代码仓库本身不会自动部署网站。

## 使用方法

1. 导入 PDF 或粘贴论文内容。
2. 点击右上角「连接 AI」，选择 DeepSeek 或 OpenAI，输入对应的 API Key。
3. 按章节翻译、讲解，勾选段落后提问；用原 PDF 页码核对公式和图表。

API 调用可能产生服务商费用。PDF 的标题与段落从可选文字中提取；扫描版可使用页面文字识别，复杂排版请以原页为准。

## 代码位置

- `app/reader.tsx`：导入、阅读、章节导航和选段交互
- `lib/paper.ts`：段落提取与章节划分
- `app/api/assist/route.ts`：模型请求、输出校验与引用检查
- `app/globals.css`：界面样式

