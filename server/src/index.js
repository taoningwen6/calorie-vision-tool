import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import OpenAI from 'openai';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverDir, '../..');
const clientDistDir = resolve(projectRoot, 'client/dist');
dotenv.config({ path: resolve(projectRoot, '.env') });

const app = express();
const port = Number(process.env.PORT || 3001);
const isServerless = Boolean(process.env.VERCEL);
const model = process.env.QWEN_MODEL || 'qwen3-vl-flash';
const baseURL =
  process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '18mb' }));

const profileSchema = z.object({
  goal: z.enum(['lose', 'maintain', 'gain']).default('maintain'),
  sex: z.enum(['female', 'male', 'unspecified']).default('unspecified'),
  age: z.coerce.number().int().min(1).max(120).optional(),
  heightCm: z.coerce.number().min(80).max(260).optional(),
  weightKg: z.coerce.number().min(20).max(300).optional(),
  targetWeightKg: z.coerce.number().min(20).max(300).optional(),
  activityLevel: z
    .enum(['busy', 'light', 'cardio', 'heavy'])
    .default('light'),
  extraIntake: z
    .enum(['none', 'light', 'moderate', 'high', 'clean', 'small', 'messy'])
    .default('none')
    .optional()
});

const analyzeSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
  mealName: z.string().trim().max(12).optional(),
  imageBase64: z.string().startsWith('data:image/'),
  leftoverImageBase64: z.string().startsWith('data:image/').optional(),
  comment: z.string().trim().max(50).optional().default(''),
  profile: profileSchema
});

const dailySummarySchema = z.object({
  profile: profileSchema,
  recommendedCalories: z.number(),
  totalCalories: z.number(),
  extraIntake: z
    .object({
      value: z.string(),
      label: z.string(),
      calories: z.number()
    })
    .optional(),
  meals: z.array(
    z.object({
      mealType: z.enum(['breakfast', 'lunch', 'dinner']),
      skipped: z.boolean().default(false),
      totalCalories: z.number(),
      comment: z.string().optional().default(''),
      advice: z.string().optional().default('')
    })
  )
});

const resultSchema = z.object({
  foods: z.array(
    z.object({
      name: z.string(),
      portion: z.string(),
      calories: z.number(),
      confidence: z.number().min(0).max(1)
    })
  ),
  totalCalories: z.number(),
  macros: z.object({
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number()
  }),
  confidence: z.number().min(0).max(1),
  portionNotes: z.string(),
  advice: z.string(),
  warnings: z.array(z.string()),
  comparison: z.object({
    usedLeftoverImage: z.boolean(),
    originalCalories: z.number(),
    leftoverCalories: z.number(),
    consumedCalories: z.number(),
    summary: z.string()
  })
});

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'foods',
    'totalCalories',
    'macros',
    'confidence',
    'portionNotes',
    'advice',
    'warnings',
    'comparison'
  ],
  properties: {
    foods: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'portion', 'calories', 'confidence'],
        properties: {
          name: { type: 'string' },
          portion: { type: 'string' },
          calories: { type: 'number' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    totalCalories: { type: 'number' },
    macros: {
      type: 'object',
      additionalProperties: false,
      required: ['proteinG', 'carbsG', 'fatG'],
      properties: {
        proteinG: { type: 'number' },
        carbsG: { type: 'number' },
        fatG: { type: 'number' }
      }
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    portionNotes: { type: 'string' },
    advice: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    },
    comparison: {
      type: 'object',
      additionalProperties: false,
      required: [
        'usedLeftoverImage',
        'originalCalories',
        'leftoverCalories',
        'consumedCalories',
        'summary'
      ],
      properties: {
        usedLeftoverImage: { type: 'boolean' },
        originalCalories: { type: 'number' },
        leftoverCalories: { type: 'number' },
        consumedCalories: { type: 'number' },
        summary: { type: 'string' }
      }
    }
  }
};

function mealLabel(mealType) {
  return {
    breakfast: '早餐',
    lunch: '午餐',
    dinner: '晚餐'
  }[mealType];
}

function mealAdviceFocus(mealType) {
  return {
    breakfast:
      '早餐建议重点看上午启动能量、蛋白质和饱腹感；避免只有高糖或纯碳水，建议补充蛋白质或乳制品。',
    lunch:
      '午餐建议重点看下午是否扛饿、主食/蛋白/蔬菜是否均衡；如果油脂或主食偏多，建议晚餐清爽一点。',
    dinner:
      '晚餐建议重点看睡前负担、油脂和总热量；如果偏重，建议减少夜间加餐，补水并把明天早餐安排稳定。'
  }[mealType];
}

function profileText(profile) {
  const goals = {
    lose: '减脂',
    maintain: '维持',
    gain: '增肌'
  };
  const activities = {
    busy: '久坐/通勤，例如散步10分钟，运动消耗约 0-80 kcal',
    light: '轻微活动，例如散步30分钟，运动消耗约 80-180 kcal',
    cardio: '常规有氧，例如跑步/爬坡30分钟，运动消耗约 180-350 kcal',
    heavy: '大量运动，例如高强度力量/球类60分钟，运动消耗约 250-450 kcal'
  };

  return [
    `目标: ${goals[profile.goal]}`,
    `性别: ${profile.sex}`,
    profile.age ? `年龄: ${profile.age}` : null,
    profile.heightCm ? `身高: ${profile.heightCm}cm` : null,
    profile.weightKg ? `体重: ${profile.weightKg}kg` : null,
    profile.targetWeightKg ? `目标体重: ${profile.targetWeightKg}kg` : null,
    `活动量: ${activities[profile.activityLevel]}`
  ]
    .filter(Boolean)
    .join('；');
}

function parseModelContent(content) {
  if (typeof content !== 'string') {
    throw new Error('模型没有返回文本内容');
  }

  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function getOpenAIClient() {
  if (!process.env.DASHSCOPE_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL
  });
}

function buildPrompt({ mealType, mealName, profile, hasLeftover, comment }) {
  const label = mealName || mealLabel(mealType);
  const base = [
    `这餐是什么: ${label}。`,
    `请分析这份${label}。`,
    `用户资料: ${profileText(profile)}。`,
    `本餐建议侧重点: ${mealAdviceFocus(mealType)}`,
    comment ? `用户补充评论: ${comment}` : '用户没有补充评论。',
    '请识别主要食物，估算份量、热量和蛋白质/碳水/脂肪。',
    '用户补充评论是重要线索，请结合图片一起理解。评论里提到食物名称、没吃/没喝、吃了一半、剩了一部分、只计算某几样时，请自然地据此调整实际摄入热量。',
    '如果评论像“是酸菜包子，豆浆没喝”，通常理解为酸菜包子参与估算，豆浆不参与估算；如果评论本身含糊，就按图片和常见份量综合判断，并在 portionNotes 里说明不确定点。',
    '如果用户提到某个食物吃了一半、1/3、剩了一半等，请按你对语义的理解折算那一项，不需要机械套规则。',
    '热量估计要比直觉预估略激进、偏高一点点：优先选择常见份量区间的中上值，把烹调用油、酱汁、糖、坚果、奶制品等隐形热量计入。若视觉估计在 550 kcal 左右，最终 totalCalories 和对应食物热量可输出到约 620 kcal；一般可比直觉估算高 8%-15%，但不要夸张翻倍。',
    'advice 使用简洁、科学的风格，不要过度情绪化。用 2-3 句说明这餐主要吃了什么、结构是否均衡，并根据早餐/午餐/晚餐的侧重点给一个明确建议；总长度控制在 90 字以内。',
    '热量只是估算，不做医疗诊断。看不清或份量不确定时，降低 confidence，并把原因写进 portionNotes 或 warnings。'
  ];

  if (hasLeftover) {
    base.push(
      '你会看到两张图：第一张是开吃前的餐食，第二张是剩下的饭菜。',
      '请先估算开吃前总热量 originalCalories，再估算剩余热量 leftoverCalories，最后用减法得到实际吃掉的 consumedCalories。',
      'totalCalories 尽量反映实际吃下的 consumedCalories；foods 列表描述你判断的实际摄入食物和份量。',
      '减法后的 consumedCalories 也按略微偏高原则输出，剩余量不确定时宁可少扣一点，避免低估实际摄入。',
      'comparison.summary 用一句人话解释这次减法，例如“看起来米饭大约吃了一半，酱汁和虾仁吃掉不少”。'
    );
  } else {
    base.push(
      '没有剩饭图时，按这张图里的整份餐食估算。comparison.usedLeftoverImage 为 false，originalCalories、consumedCalories、totalCalories 三者保持一致，leftoverCalories 为 0。'
    );
  }

  base.push(
    '如果图片里不是食物，返回空 foods、0 热量、低 confidence，并用温和语气说明原因。'
  );

  return base.join('\n');
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: 'dashscope',
    model,
    hasApiKey: Boolean(process.env.DASHSCOPE_API_KEY)
  });
});

app.post('/api/analyze-meal', async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: '请求格式不正确',
      details: parsed.error.flatten()
    });
  }

  const client = getOpenAIClient();
  if (!client) {
    return res.status(500).json({
      error: '未配置 DASHSCOPE_API_KEY',
      details: '请复制 .env.example 为 .env，并填入千问云 / DashScope API Key。'
    });
  }

  const { mealType, mealName, imageBase64, leftoverImageBase64, comment, profile } = parsed.data;
  const hasLeftover = Boolean(leftoverImageBase64);
  const content = [
    {
      type: 'text',
      text: buildPrompt({ mealType, mealName, profile, hasLeftover, comment })
    },
    {
      type: 'image_url',
      image_url: {
        url: imageBase64
      }
    }
  ];

  if (leftoverImageBase64) {
    content.push(
      {
        type: 'text',
        text: '下面这张是同一餐吃完后剩下的饭菜，用它做减法。'
      },
      {
        type: 'image_url',
        image_url: {
          url: leftoverImageBase64
        }
      }
    );
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 1000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'meal_calorie_analysis',
          strict: true,
          schema: jsonSchema
        }
      },
      messages: [
        {
          role: 'system',
          content:
            '你是一个谨慎的中文饮食热量估算助手。只输出符合 schema 的 JSON。每餐 advice 要简洁、科学，概括主要食物、结构判断和一个建议。热量和营养都是估算，不做医疗诊断；为了避免低估摄入，热量要比直觉预估略微偏高，优先按常见份量的中上值和完整调味/烹调用油估算。'
        },
        {
          role: 'user',
          content
        }
      ]
    });

    const modelContent = completion.choices?.[0]?.message?.content;
    const json = parseModelContent(modelContent);
    const result = resultSchema.parse(json);

    res.json({
      ...result,
      model,
      provider: 'dashscope'
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({
      error: '图像识别失败',
      details:
        error?.message ||
        '请检查网络、DASHSCOPE_API_KEY、QWEN_MODEL，或稍后重试。'
    });
  }
});

app.post('/api/daily-summary', async (req, res) => {
  const parsed = dailySummarySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: '请求格式不正确',
      details: parsed.error.flatten()
    });
  }

  const client = getOpenAIClient();
  if (!client) {
    return res.status(500).json({
      error: '未配置 DASHSCOPE_API_KEY',
      details: '请复制 .env.example 为 .env，并填入千问云 / DashScope API Key。'
    });
  }

  const { profile, recommendedCalories, totalCalories, extraIntake, meals } = parsed.data;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.45,
      max_tokens: 260,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是一个温暖、鼓励为主的中文饮食记录伙伴。只输出 JSON，格式为 {"summary":"..."}。总结要有人味，不责备，不制造焦虑，80 字以内。'
        },
        {
          role: 'user',
          content: [
            `用户资料: ${profileText(profile)}`,
            `今日推荐热量: ${Math.round(recommendedCalories)} kcal`,
            `今日实际吃下: ${Math.round(totalCalories)} kcal`,
            `今日活动量: ${profile.activityLevel}`,
            extraIntake
              ? `额外摄入: ${extraIntake.label}，估算 ${Math.round(extraIntake.calories)} kcal`
              : '额外摄入: 未记录',
            `三餐记录: ${JSON.stringify(meals)}。`,
            '请基于目标、三餐和活动量，生成一句鼓励为主的今日总结。如果没吃某餐，也温和提醒不要长期忽略正餐。'
          ].join('\n')
        }
      ]
    });

    const content = completion.choices?.[0]?.message?.content;
    const json = parseModelContent(content);
    res.json({
      summary: String(json.summary || '').slice(0, 160)
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({
      error: '今日总结生成失败',
      details:
        error?.message ||
        '请检查网络、DASHSCOPE_API_KEY、QWEN_MODEL，或稍后重试。'
    });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(resolve(clientDistDir, 'index.html'));
  });
}

if (!isServerless) {
  app.listen(port, () => {
    console.log(`Calorie vision server listening on http://127.0.0.1:${port}`);
  });
}

export default app;
