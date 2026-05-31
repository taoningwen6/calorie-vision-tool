import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertCircle,
  Camera,
  Flame,
  ImagePlus,
  Loader2,
  RotateCcw,
  Sparkles,
  Target,
  Utensils,
  XCircle
} from 'lucide-react';
import './styles.css';

const meals = [
  { id: 'breakfast', label: '早餐' },
  { id: 'lunch', label: '午餐' },
  { id: 'dinner', label: '晚餐' }
];

const activityOptions = [
  { value: 'busy', label: '今天忙，没啥运动', factor: 1.15 },
  { value: 'light', label: '有一点点轻微运动', factor: 1.25 },
  { value: 'cardio', label: '去进行了正常强度的有氧、跑步、爬坡', factor: 1.45 },
  { value: 'heavy', label: '今日有大量运动！', factor: 1.7 }
];

const extraIntakeOptions = [
  { value: 'clean', label: '今天很乖，最多只喝了美式', calories: 20 },
  { value: 'small', label: '多摄入了一点点，影响不大', calories: 90 },
  { value: 'messy', label: '吃了不少乱七八糟的，下次一定乖', calories: 220 }
];

const defaultProfile = {
  profileVersion: 2,
  goal: 'lose',
  sex: 'female',
  age: '24',
  heightCm: '170',
  weightKg: '62.5',
  targetWeightKg: '57',
  activityLevel: 'light',
  extraIntake: 'clean'
};

const defaultRecords = meals.reduce((acc, meal) => {
  acc[meal.id] = {
    image: '',
    leftoverImage: '',
    comment: '',
    skipped: false,
    result: null,
    status: 'idle',
    error: ''
  };
  return acc;
}, {});

function normalizeRecords(records) {
  return meals.reduce((acc, meal) => {
    acc[meal.id] = {
      ...defaultRecords[meal.id],
      ...(records?.[meal.id] || {})
    };
    return acc;
  }, {});
}

function loadStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function loadProfile() {
  const stored = loadStored('calorie-profile', defaultProfile);
  const activityMap = {
    rest: 'busy',
    low: 'light',
    medium: 'light',
    high: 'cardio',
    very_high: 'heavy'
  };

  if (stored?.profileVersion === defaultProfile.profileVersion) {
    return {
      ...defaultProfile,
      ...stored,
      activityLevel: activityMap[stored.activityLevel] || stored.activityLevel || defaultProfile.activityLevel
    };
  }

  return {
    ...defaultProfile,
    activityLevel: activityMap[stored?.activityLevel] || stored?.activityLevel || defaultProfile.activityLevel,
    extraIntake: stored?.extraIntake || defaultProfile.extraIntake
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

async function compressImage(file, maxSize = 1280, quality = 0.82) {
  const imageUrl = URL.createObjectURL(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageUrl;
  });

  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(12, Math.round(image.width * scale));
  const height = Math.max(12, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(imageUrl);

  return canvas.toDataURL('image/jpeg', quality);
}

function buildProfile(profile) {
  return {
    goal: profile.goal,
    sex: profile.sex,
    age: profile.age ? Number(profile.age) : undefined,
    heightCm: profile.heightCm ? Number(profile.heightCm) : undefined,
    weightKg: profile.weightKg ? Number(profile.weightKg) : undefined,
    targetWeightKg: profile.targetWeightKg ? Number(profile.targetWeightKg) : undefined,
    activityLevel: profile.activityLevel,
    extraIntake: profile.extraIntake
  };
}

function getExtraIntake(profile) {
  return (
    extraIntakeOptions.find((option) => option.value === profile.extraIntake) ||
    extraIntakeOptions[0]
  );
}

function getGoalText(goal) {
  return {
    lose: '减脂',
    maintain: '维持',
    gain: '增肌'
  }[goal];
}

function estimateRecommendedCalories(profile) {
  const sex = profile.sex;
  const age = Number(profile.age);
  const height = Number(profile.heightCm);
  const weight = Number(profile.weightKg);

  if (!age || !height || !weight || sex === 'unspecified') {
    return 2000;
  }

  const base =
    sex === 'male'
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;
  const factor =
    activityOptions.find((option) => option.value === profile.activityLevel)?.factor || 1.4;
  const goalAdjust = {
    lose: -350,
    maintain: 0,
    gain: 280
  }[profile.goal];

  return clamp(Math.round(base * factor + goalAdjust), 1100, 3800);
}

function getMealRecommendation(mealId, recommendedCalories, extraCalories = 0) {
  const available = Math.max(900, recommendedCalories - extraCalories);
  const ratios = {
    breakfast: 0.3,
    lunch: 0.4,
    dinner: 0.3
  };

  return Math.round((available * (ratios[mealId] || 0.33)) / 10) * 10;
}

function getSummary(records, profile) {
  const mealSummary = meals.reduce(
    (summary, meal) => {
      const record = records[meal.id];
      if (record?.skipped) {
        summary.completed += 1;
        summary.skipped += 1;
        return summary;
      }

      const result = record?.result;
      if (!result) return summary;

      summary.totalCalories += formatNumber(result.totalCalories);
      summary.macros.proteinG += formatNumber(result.macros?.proteinG);
      summary.macros.carbsG += formatNumber(result.macros?.carbsG);
      summary.macros.fatG += formatNumber(result.macros?.fatG);
      summary.completed += 1;

      return summary;
    },
    {
      totalCalories: 0,
      completed: 0,
      skipped: 0,
      macros: {
        proteinG: 0,
        carbsG: 0,
        fatG: 0
      }
    }
  );

  const extra = getExtraIntake(profile);
  return {
    ...mealSummary,
    mealCalories: mealSummary.totalCalories,
    extraCalories: extra.calories,
    totalCalories: mealSummary.totalCalories + extra.calories
  };
}

function getNextSuggestion(summary, profile, recommendedCalories) {
  if (summary.completed === 0) {
    return '先上传任意一餐，我会帮你把热量和建议慢慢拼起来。别急，记录这件事本身就很棒。';
  }

  const remaining = recommendedCalories - summary.totalCalories;
  if (remaining < 0) {
    return `今天已经超过推荐值一点点了，没关系，知道发生了什么就很有用。下一餐或明天轻一点就好。`;
  }

  if (profile.goal === 'gain' && summary.macros.proteinG < 60 && summary.completed >= 2) {
    return '今天蛋白质还可以再补一补。加个鸡蛋、鱼肉、牛奶或豆制品，会更贴近增肌目标。';
  }

  return `已记录 ${summary.completed}/3 餐，还剩大约 ${formatNumber(remaining)} kcal 的空间。节奏不错，继续来。`;
}

function getPresetEncouragement(records) {
  const breakfastDone = Boolean(records.breakfast?.skipped || records.breakfast?.result);
  const lunchDone = Boolean(records.lunch?.skipped || records.lunch?.result);
  const dinnerDone = Boolean(records.dinner?.skipped || records.dinner?.result);

  if (!breakfastDone) {
    return '慢慢记录就很好啦。记得按时吃早饭哦。';
  }

  if (!lunchDone) {
    return '早餐记录好啦。记得按时吃午饭哦。';
  }

  if (!dinnerDone) {
    return '今天已经记录到午饭啦。晚上也要好好吃饭哦。';
  }

  return '三餐都记录好啦。可以点“今日总结”，看看鱼鱼宝的小总结。';
}

function ProfilePanel({ profile, onChange, recommendedCalories }) {
  function update(field, value) {
    onChange({ ...profile, [field]: value });
  }

  return (
    <section className="panel profile-panel" aria-labelledby="profile-title">
      <div className="section-title">
        <Target size={20} />
        <div>
          <h2 id="profile-title">目标资料</h2>
        </div>
      </div>

      <div className="segmented" aria-label="目标">
        {[
          ['lose', '减脂'],
          ['maintain', '维持'],
          ['gain', '增肌']
        ].map(([value, label]) => (
          <button
            key={value}
            className={profile.goal === value ? 'active' : ''}
            type="button"
            onClick={() => update('goal', value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="subsection-label">基本数据</div>
      <div className="fixed-profile-grid">
        <label>
          <span>性别</span>
          <select value={profile.sex} onChange={(event) => update('sex', event.target.value)}>
            <option value="unspecified">不指定</option>
            <option value="female">女性</option>
            <option value="male">男性</option>
          </select>
        </label>
        <label>
          <span>年龄</span>
          <input
            inputMode="numeric"
            max="120"
            min="1"
            placeholder="30"
            type="number"
            value={profile.age}
            onChange={(event) => update('age', event.target.value)}
          />
        </label>
        <label>
          <span>身高 cm</span>
          <input
            inputMode="decimal"
            max="260"
            min="80"
            placeholder="170"
            type="number"
            value={profile.heightCm}
            onChange={(event) => update('heightCm', event.target.value)}
          />
        </label>
        <label>
          <span>当前 kg</span>
          <input
            inputMode="decimal"
            max="300"
            min="20"
            placeholder="65"
            type="number"
            value={profile.weightKg}
            onChange={(event) => update('weightKg', event.target.value)}
          />
        </label>
        <label>
          <span>目标 kg</span>
          <input
            inputMode="decimal"
            max="300"
            min="20"
            placeholder="60"
            type="number"
            value={profile.targetWeightKg}
            onChange={(event) => update('targetWeightKg', event.target.value)}
          />
        </label>
      </div>

      <div className="subsection-label">今日活动</div>
      <div className="activity-row">
        <label className="activity-field">
          <span>今日活动量</span>
          <select
            value={profile.activityLevel}
            onChange={(event) => update('activityLevel', event.target.value)}
          >
            {activityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="activity-field">
          <span>额外摄入</span>
          <select
            value={profile.extraIntake}
            onChange={(event) => update('extraIntake', event.target.value)}
          >
            {extraIntakeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（约 {option.calories} kcal）
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="calorie-chip">
        今日推荐约 <strong>{formatNumber(recommendedCalories)}</strong> kcal
      </div>
    </section>
  );
}

function SummaryPanel({
  records,
  profile,
  dailySummary,
  recommendedCalories,
  allMealsDone,
  onGenerateSummary
}) {
  const summary = getSummary(records, profile);
  const progressRaw = (summary.totalCalories / recommendedCalories) * 100;
  const progress = clamp(progressRaw, 0, 92);
  const isOverTarget = summary.totalCalories > recommendedCalories;
  const presetEncouragement = getPresetEncouragement(records);

  return (
    <section className="panel summary-panel" aria-labelledby="summary-title">
      <div className="section-title">
        <Activity size={20} />
        <div>
          <h2 id="summary-title">今日汇总</h2>
          <p>
            {summary.completed}/3 餐已记录，目标 {formatNumber(recommendedCalories)} kcal
          </p>
        </div>
      </div>

      <div className="calorie-meter">
        <div>
          <span>吃下热量</span>
          <strong className={isOverTarget ? 'over-target' : ''}>{summary.totalCalories}</strong>
          <em>/ {formatNumber(recommendedCalories)} kcal</em>
        </div>
        <div className={`progress ${isOverTarget ? 'over' : ''}`} aria-label="今日热量进度">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="macro-row">
        <span>蛋白 {summary.macros.proteinG}g</span>
        <span>碳水 {summary.macros.carbsG}g</span>
        <span>脂肪 {summary.macros.fatG}g</span>
        <span>额外 {summary.extraCalories} kcal</span>
        {summary.skipped > 0 && <span>没吃 {summary.skipped} 餐</span>}
      </div>

      {!dailySummary.text && dailySummary.status !== 'error' && (
        <div className="preset-encourage">
          <Sparkles size={18} />
          <p>{presetEncouragement}</p>
        </div>
      )}

      {allMealsDone && (
        <button
          className="summary-button"
          disabled={dailySummary.status === 'loading'}
          type="button"
          onClick={onGenerateSummary}
        >
          <Sparkles size={18} />
          <span>{dailySummary.status === 'loading' ? '生成中...' : '今日总结'}</span>
        </button>
      )}

      {dailySummary.text && (
        <div className="advice-box">
          <Sparkles size={18} />
          <p>{dailySummary.text}</p>
        </div>
      )}

      {dailySummary.status === 'error' && (
        <div className="error-box">
          <AlertCircle size={17} />
          <p>{dailySummary.error}</p>
        </div>
      )}
    </section>
  );
}

function MealCard({ meal, record, profile, recommendedCalories, onUpdate }) {
  function patchRecord(patch) {
    onUpdate(meal.id, {
      ...record,
      ...patch
    });
  }

  async function analyze(nextImage = record.image, nextLeftoverImage = record.leftoverImage) {
    onUpdate(meal.id, {
      ...record,
      image: nextImage,
      leftoverImage: nextLeftoverImage || '',
      skipped: false,
      result: null,
      status: 'loading',
      error: ''
    });

    try {
      const response = await fetch('/api/analyze-meal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mealType: meal.id,
          mealName: meal.label,
          imageBase64: nextImage,
          leftoverImageBase64: nextLeftoverImage || undefined,
          comment: record.comment || '',
          profile: buildProfile(profile)
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.details || payload.error || '识别失败');
      }

      onUpdate(meal.id, {
        ...record,
        image: nextImage,
        leftoverImage: nextLeftoverImage || '',
        skipped: false,
        result: payload,
        status: 'done',
        error: ''
      });
    } catch (error) {
      onUpdate(meal.id, {
        ...record,
        image: nextImage,
        leftoverImage: nextLeftoverImage || '',
        skipped: false,
        result: null,
        status: 'error',
        error: error.message || '识别失败，请重试。'
      });
    }
  }

  async function handleMainFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const compressed = await compressImage(file);
      patchRecord({
        image: compressed,
        leftoverImage: '',
        skipped: false,
        result: null,
        status: 'ready',
        error: ''
      });
    } catch (error) {
      patchRecord({
        status: 'error',
        error: error.message || '图片处理失败'
      });
    }
  }

  async function handleLeftoverFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !record.image) return;

    try {
      const compressed = await compressImage(file, 1100, 0.78);
      patchRecord({
        leftoverImage: compressed,
        result: null,
        status: 'ready',
        error: ''
      });
    } catch (error) {
      patchRecord({
        status: 'error',
        error: error.message || '剩饭图片处理失败'
      });
    }
  }

  function skipMeal() {
    onUpdate(meal.id, {
      ...record,
      image: '',
      leftoverImage: '',
      skipped: true,
      result: null,
      status: 'skipped',
      error: ''
    });
  }

  function updateComment(value) {
    patchRecord({
      comment: value.slice(0, 50),
      result: record.image ? null : record.result,
      status: record.image && record.status !== 'loading' ? 'ready' : record.status,
      error: ''
    });
  }

  const confidence = record.result ? Math.round(record.result.confidence * 100) : 0;
  const comparison = record.result?.comparison;
  const usedLeftover = Boolean(record.leftoverImage);
  const recommendedMealCalories = getMealRecommendation(
    meal.id,
    recommendedCalories,
    getExtraIntake(profile).calories
  );

  return (
    <article className="meal-card">
      <header>
        <div>
          <h3>{meal.label}</h3>
        </div>
        <div className={`status ${record.status}`}>
          {record.status === 'loading' ? <Loader2 size={15} /> : <Flame size={15} />}
          <span>
            {record.status === 'done'
              ? `${formatNumber(record.result?.totalCalories)} kcal`
              : record.status === 'loading'
                ? '识别中'
                : record.status === 'error'
                  ? '需重试'
                  : record.status === 'skipped'
                    ? '没吃'
                    : record.status === 'ready'
                      ? '待分析'
                      : `推荐 ${recommendedMealCalories} kcal`}
          </span>
        </div>
      </header>

      <div className="photo-area">
        {record.image ? (
          <>
            <img alt={`${meal.label}开吃前预览`} src={record.image} />
            {record.status !== 'loading' && (
              <button className="analyze-button" type="button" onClick={() => analyze()}>
                {record.result ? '重新分析' : '开始分析'}
              </button>
            )}
          </>
        ) : record.skipped ? (
          <div className="empty-photo">
            <XCircle size={34} />
            <span>这顿没吃，不计入统计</span>
          </div>
        ) : (
          <div className="empty-photo">
            <Utensils size={34} />
            <span>拍一张开吃前的餐图</span>
          </div>
        )}
      </div>

      <label className="meal-comment">
        <span>这餐小备注</span>
        <input
          maxLength="50"
          placeholder="可选填"
          value={record.comment}
          onChange={(event) => updateComment(event.target.value)}
        />
        <em>{record.comment.length}/50</em>
      </label>

      <div className="action-row">
        <label className="icon-button">
          <Camera size={18} />
          <span>拍照/上传</span>
          <input
            accept="image/*"
            capture="environment"
            type="file"
            onChange={handleMainFileChange}
          />
        </label>

      </div>

      <div className="leftover-row">
        <label className={`leftover-upload ${!record.image ? 'disabled' : ''}`}>
          <ImagePlus size={16} />
          <span>{record.leftoverImage ? '更换剩下的饭菜' : '上传剩下的饭菜'}</span>
          <input
            accept="image/*"
            capture="environment"
            disabled={!record.image}
            type="file"
            onChange={handleLeftoverFileChange}
          />
        </label>
        <button className="skip-button" type="button" onClick={skipMeal}>
          这顿没吃
        </button>
        {record.leftoverImage && (
          <div className="leftover-preview">
            <img alt={`${meal.label}剩饭预览`} src={record.leftoverImage} />
            <span>已做减法</span>
          </div>
        )}
      </div>

      {record.status === 'error' && (
        <div className="error-box" role="alert">
          <AlertCircle size={17} />
          <p>{record.error}</p>
        </div>
      )}

      {record.result && (
        <div className="result-block">
          <div className="confidence">
            <span>{usedLeftover ? '吃下热量可信度' : '可信度'}</span>
            <strong>{confidence}%</strong>
          </div>

          {comparison?.usedLeftoverImage && (
            <div className="subtraction-box">
              <span>开吃前 {formatNumber(comparison.originalCalories)} kcal</span>
              <strong>吃下 {formatNumber(comparison.consumedCalories)} kcal</strong>
            </div>
          )}

          <ul className="food-list">
            {record.result.foods.map((food, index) => (
              <li key={`${food.name}-${index}`}>
                <span>{food.name}</span>
                <em>{food.portion}</em>
                <strong>{formatNumber(food.calories)} kcal</strong>
              </li>
            ))}
          </ul>
          <div className="mini-macros">
            <span>蛋白 {formatNumber(record.result.macros?.proteinG)}g</span>
            <span>碳水 {formatNumber(record.result.macros?.carbsG)}g</span>
            <span>脂肪 {formatNumber(record.result.macros?.fatG)}g</span>
          </div>
          <p className="note">{record.result.portionNotes}</p>
          <p className="note strong">{record.result.advice}</p>
        </div>
      )}
    </article>
  );
}

function App() {
  const [profile, setProfile] = React.useState(loadProfile);
  const [records, setRecords] = React.useState(() =>
    normalizeRecords(loadStored('calorie-records', defaultRecords))
  );
  const [dailySummary, setDailySummary] = React.useState({
    key: '',
    text: '',
    status: 'idle',
    error: ''
  });
  const [showBadge, setShowBadge] = React.useState(false);

  const recommendedCalories = estimateRecommendedCalories(profile);
  const summary = getSummary(records, profile);
  const allMealsDone = meals.every((meal) => {
    const record = records[meal.id];
    return record?.skipped || record?.result;
  });
  const summaryKey = JSON.stringify({
    profile: buildProfile(profile),
    recommendedCalories,
    totalCalories: summary.totalCalories,
    extraIntake: getExtraIntake(profile),
    meals: meals.map((meal) => {
      const record = records[meal.id];
      return {
        mealType: meal.id,
        skipped: Boolean(record?.skipped),
        totalCalories: record?.skipped ? 0 : formatNumber(record?.result?.totalCalories),
        comment: record?.comment || '',
        advice: record?.result?.advice || ''
      };
    })
  });
  const visibleDailySummary =
    dailySummary.key === summaryKey ? dailySummary : { key: '', text: '', status: 'idle', error: '' };

  React.useEffect(() => {
    localStorage.setItem('calorie-profile', JSON.stringify(profile));
  }, [profile]);

  React.useEffect(() => {
    localStorage.setItem('calorie-records', JSON.stringify(records));
  }, [records]);

  async function generateDailySummary() {
    if (!allMealsDone || dailySummary.status === 'loading') return;

    setDailySummary({ key: summaryKey, text: '', status: 'loading', error: '' });

    try {
      const response = await fetch('/api/daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: summaryKey
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || '今日总结生成失败');

      setDailySummary({
        key: summaryKey,
        text: payload.summary || '',
        status: 'done',
        error: ''
      });

      if (summary.totalCalories <= recommendedCalories) {
        setShowBadge(true);
      }
    } catch (error) {
      setDailySummary({
        key: summaryKey,
        text: '',
        status: 'error',
        error: error.message || '今日总结生成失败'
      });
    }
  }

  function updateRecord(mealId, nextRecord) {
    setRecords((current) => ({
      ...current,
      [mealId]: nextRecord
    }));
  }

  function resetDay() {
    setRecords(defaultRecords);
    setDailySummary({ key: '', text: '', status: 'idle', error: '' });
    setShowBadge(false);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">AI meal check</p>
          <h1>Hi 我是鱼鱼</h1>
          <p className="intro">我可以记录每日摄入和消耗，我们一起加油！</p>
        </div>
        <button className="reset-button" type="button" onClick={resetDay}>
          <RotateCcw size={17} />
          <span>清空今日</span>
        </button>
      </section>

      <section className="dashboard-grid">
        <ProfilePanel
          profile={profile}
          recommendedCalories={recommendedCalories}
          onChange={setProfile}
        />
        <SummaryPanel
          dailySummary={visibleDailySummary}
          profile={profile}
          recommendedCalories={recommendedCalories}
          records={records}
          allMealsDone={allMealsDone}
          onGenerateSummary={generateDailySummary}
        />
      </section>

      <section className="meal-grid" aria-label="三餐上传">
        {meals.map((meal) => (
          <MealCard
            key={meal.id}
            meal={meal}
            profile={profile}
            recommendedCalories={recommendedCalories}
            record={records[meal.id] || defaultRecords[meal.id]}
            onUpdate={updateRecord}
          />
        ))}
      </section>

      <footer className="disclaimer">
        <ImagePlus size={16} />
        <span>热量结果为 AI 估算，仅用于日常记录参考，不替代医疗或营养师建议。</span>
      </footer>

      {showBadge && (
        <button className="badge-overlay" type="button" onClick={() => setShowBadge(false)}>
          <span className="badge-medal">
            <strong>棒棒</strong>
            <em>今日没有超标</em>
          </span>
        </button>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
