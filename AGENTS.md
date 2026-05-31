# 热量识别工具开发说明

## 产品目标

构建一个本地可运行的 Web 原型，用于自动拍照或上传一日三餐图片，并通过视觉模型估算食物热量，输出饮食建议。

第一版聚焦基础可行性：
- 早餐 / 午餐 / 晚餐三餐卡片
- 拍照或上传图片
- AI 图像识别食物与份量
- 输出估算热量、宏量营养、可信度与不确定原因
- 根据用户目标给出饮食建议
- 今日总热量汇总

## 技术栈

- Frontend: React + Vite
- Backend: Node.js + Express
- AI Provider: 国内千问云 / DashScope
- 默认模型: qwen3-vl-flash
- 可选更高准确率模型: qwen3-vl-plus
- 本地数据: localStorage
- 不做账号、数据库、云部署

## Qwen API 配置

后端使用千问云 OpenAI 兼容接口。

环境变量：
- `DASHSCOPE_API_KEY`
- `QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `QWEN_MODEL=qwen3-vl-flash`
- `PORT=3001`

API Key 必须只放在后端 `.env`，不得写入前端代码，不得提交到仓库。

## 后端接口

### POST /api/analyze-meal

请求体：
```json
{
  "mealType": "breakfast | lunch | dinner",
  "imageBase64": "data:image/jpeg;base64,...",
  "profile": {
    "goal": "lose | maintain | gain",
    "sex": "female | male | unspecified",
    "age": 30,
    "heightCm": 170,
    "weightKg": 65,
    "activityLevel": "low | medium | high"
  }
}
```

响应体：
```json
{
  "foods": [
    {
      "name": "米饭",
      "portion": "约一小碗",
      "calories": 180,
      "confidence": 0.76
    }
  ],
  "totalCalories": 620,
  "macros": {
    "proteinG": 28,
    "carbsG": 78,
    "fatG": 20
  },
  "confidence": 0.72,
  "portionNotes": "份量基于图片估算，碗的大小可能影响结果。",
  "advice": "这餐碳水偏高，晚餐可增加蔬菜和优质蛋白。",
  "warnings": [
    "热量为 AI 估算，不作为医疗或营养诊断。"
  ]
}
```

## AI Prompt 要求

模型必须返回结构化 JSON。识别时需要：
- 识别图片中的主要食物
- 估算每种食物的份量
- 估算每种食物热量
- 汇总总热量
- 估算蛋白质、碳水、脂肪
- 给出 0 到 1 的可信度
- 如果图片不清晰或份量无法判断，必须降低可信度并说明原因
- 不提供医疗诊断，只给一般饮食建议

## 前端流程

1. 用户填写目标资料：减脂 / 维持 / 增肌、性别、年龄、身高、体重、活动量。
2. 页面显示早餐、午餐、晚餐三张卡片。
3. 每张卡片支持拍照或上传图片。
4. 上传后前端压缩图片，再调用 `/api/analyze-meal`。
5. 展示识别结果、热量、可信度、建议和重试按钮。
6. 今日汇总区域展示三餐总热量、宏量营养估算和下一餐建议。
7. 用户资料和今日记录保存在 localStorage。

## 视觉设计方向

界面应像一个轻量、清爽、可信的健康记录工具：
- 不做营销落地页
- 首页就是可用工具
- 三餐卡片清晰紧凑
- 移动端优先，桌面端也要好看
- 避免大面积紫色渐变、浮夸装饰和无意义卡片嵌套
- 所有按钮和文本在手机宽度下不能重叠或溢出

## 验证要求

实现后运行：
- `npm.cmd install`
- `npm.cmd run dev`
- 前端构建检查
- 浏览器检查桌面和手机视口

必须验证：
- 未配置 API Key 时错误清晰
- 三餐分别上传后能独立识别
- 刷新后 localStorage 数据保留
- 识别失败后可以重试
- `qwen3-vl-flash` 可通过 `.env` 切换为 `qwen3-vl-plus`
