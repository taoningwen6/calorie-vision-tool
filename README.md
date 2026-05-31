# 鱼鱼热量识别工具

一个用于拍照/上传三餐图片、通过 Qwen VL 估算热量并生成饮食建议的 Web 原型。

## 本地运行

```bash
npm install
npm run dev
```

前端默认运行在 `http://127.0.0.1:5173/`，后端默认运行在 `http://127.0.0.1:3001/`。

## 环境变量

复制 `.env.example` 为 `.env`，并填写自己的 DashScope Key：

```bash
DASHSCOPE_API_KEY=replace_with_your_dashscope_api_key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-vl-flash
PORT=3001
```

不要把真实 Key 提交到 GitHub。

## 推荐部署方式

这个项目需要安全后端代理 Qwen API，所以不适合只部署到 GitHub Pages。推荐用 GitHub 作为代码仓库，再连接 Render 部署成一个完整网站。

Render 设置：

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment:
  - `NODE_ENV=production`
  - `DASHSCOPE_API_KEY=你的 DashScope Key`
  - `QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
  - `QWEN_MODEL=qwen3-vl-flash`

仓库里已经包含 `render.yaml`，Render Blueprint 可以直接读取。

## 可选部署方式

仓库也包含 `vercel.json` 和 `api/[...path].js`，可以尝试部署到 Vercel。图片识别接口耗时可能较长，如果遇到函数超时，优先使用 Render。
