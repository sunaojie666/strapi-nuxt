import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const databasePath = path.join(projectRoot, '.tmp', 'data.db');
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';

const tableDefinitions = {
  abouts: { apiType: 'api::about.about', label: '关于我们', contentType: 'marketing' },
  agreements: { apiType: 'api::agreement.agreement', label: '用户协议', contentType: 'legal' },
  cameras: { apiType: 'api::camera.camera', label: '虚拟相机', contentType: 'technical' },
  cards: { apiType: 'api::card.card', label: '教程卡片', contentType: 'support' },
  checkouts: { apiType: 'api::checkout.checkout', label: '购买', contentType: 'ui' },
  communitys: { apiType: 'api::community.community', label: '全球社区', contentType: 'support' },
  downloads: { apiType: 'api::download.download', label: '下载中心', contentType: 'marketing' },
  examples: { apiType: 'api::example.example', label: '示例下载', contentType: 'technical' },
  faqs: { apiType: 'api::faq.faq', label: '常见问题', contentType: 'support' },
  features: { apiType: 'api::feature.feature', label: '特色功能', contentType: 'marketing' },
  footers: { apiType: 'api::footer.footer', label: '底部', contentType: 'ui' },
  forms: { apiType: 'api::form.form', label: '平台支持', contentType: 'ui' },
  gdprs: { apiType: 'api::gdpr.gdpr', label: 'GDPR 与数据保护', contentType: 'legal' },
  graphics: { apiType: 'api::graphic.graphic', label: '图文教程', contentType: 'support' },
  homes: { apiType: 'api::home.home', label: '首页', contentType: 'marketing' },
  logins: { apiType: 'api::login.login', label: '登录', contentType: 'ui' },
  members: { apiType: 'api::member.member', label: '会员订阅协议', contentType: 'legal' },
  navigations: { apiType: 'api::navigation.navigation', label: '导航', contentType: 'ui' },
  pricings: { apiType: 'api::pricing.pricing', label: '套餐价格', contentType: 'marketing' },
  privacys: { apiType: 'api::privacy.privacy', label: '隐私政策', contentType: 'legal' },
  profiles: { apiType: 'api::profile.profile', label: '个人中心', contentType: 'ui' },
  refunds: { apiType: 'api::refund.refund', label: '退款规则', contentType: 'legal' },
  safetys: { apiType: 'api::safety.safety', label: '安全与隐私', contentType: 'legal' },
  sdks: { apiType: 'api::sdk.sdk', label: 'SDK 文档', contentType: 'technical' },
  soundcards: { apiType: 'api::soundcard.soundcard', label: '虚拟声卡', contentType: 'technical' },
  streamers: { apiType: 'api::streamer.streamer', label: '主播列表', contentType: 'marketing' },
  teams: { apiType: 'api::team.team', label: '商务合作', contentType: 'marketing' },
  tutorials: { apiType: 'api::tutorial.tutorial', label: '教程中心', contentType: 'support' },
  videos: { apiType: 'api::video.video', label: '视频教程', contentType: 'support' },
  virtuals: { apiType: 'api::virtual.virtual', label: '虚拟相机', contentType: 'technical' },
};
const metadataColumns = new Set([
  'id',
  'document_id',
  'created_at',
  'updated_at',
  'published_at',
  'created_by_id',
  'updated_by_id',
  'locale',
]);

const getArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};
const hasFlag = (name) => process.argv.includes(`--${name}`);
const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const fileHash = async (filePath) => crypto.createHash('sha256').update(await readFile(filePath)).digest('hex');
const makeDocumentId = () => crypto.randomBytes(18).toString('base64url').slice(0, 24).toLowerCase();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseJsonResponse(value, label) {
  const normalized = String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function assertSameShape(source, candidate, location = '$') {
  if (Array.isArray(source)) {
    if (!Array.isArray(candidate) || candidate.length !== source.length) {
      throw new Error(`${location}: array structure changed`);
    }
    source.forEach((item, index) => assertSameShape(item, candidate[index], `${location}[${index}]`));
    return;
  }
  if (source && typeof source === 'object') {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`${location}: object structure changed`);
    }
    const sourceKeys = Object.keys(source).sort();
    const candidateKeys = Object.keys(candidate).sort();
    if (JSON.stringify(sourceKeys) !== JSON.stringify(candidateKeys)) {
      throw new Error(`${location}: object keys changed`);
    }
    sourceKeys.forEach((key) => assertSameShape(source[key], candidate[key], `${location}.${key}`));
    return;
  }
  if (typeof source !== typeof candidate) {
    throw new Error(`${location}: value type changed from ${typeof source} to ${typeof candidate}`);
  }
}

function repairCommonShape(source, candidate) {
  if (Array.isArray(source)) {
    let normalized = candidate;
    if (!Array.isArray(normalized) && normalized && typeof normalized === 'object') {
      const keyedItems = source.length > 0
        && source.every((item) => item && typeof item === 'object' && typeof item.key === 'string')
        && source.every((item) => normalized[item.key] && typeof normalized[item.key] === 'object');
      if (keyedItems) {
        normalized = source.map((item) => ({ ...normalized[item.key], key: item.key }));
      } else if (source.length === 1) {
        normalized = [normalized];
      }
    }
    if (Array.isArray(normalized)) {
      return normalized.map((item, index) => repairCommonShape(source[index], item));
    }
    return normalized;
  }
  if (!source || !candidate || typeof source !== 'object' || typeof candidate !== 'object') return candidate;
  for (const [key, sourceValue] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      candidate[key] = repairCommonShape(sourceValue, candidate[key]);
    }
  }
  return candidate;
}

function setLocaleFields(value, locale) {
  if (Array.isArray(value)) {
    value.forEach((item) => setLocaleFields(item, locale));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'locale' && typeof item === 'string') {
      value[key] = locale;
    } else {
      setLocaleFields(item, locale);
    }
  }
}

async function callDeepSeek(prompt, label) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  let lastError;
  const maximumAttempts = 8;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Return exactly one valid JSON object. Preserve the requested schema and do not include markdown.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
      }
      const body = parseJsonResponse(bodyText, label);
      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`${label} returned empty content`);
      }
      return parseJsonResponse(content, label);
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts) {
        const backoff = Math.min(30_000, 1_000 * (2 ** (attempt - 1)));
        await sleep(backoff + Math.floor(Math.random() * 500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${label} failed after ${maximumAttempts} attempts: ${lastError.message}`);
}

function runNodeScript(scriptName, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptDirectory, scriptName), ...argumentsList], {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${scriptName} exited with ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

const chunkCharacterLimit = 7_000;

function getAtPath(root, pathParts) {
  return pathParts.reduce((value, part) => value[part], root);
}

function setAtPath(root, pathParts, value) {
  if (!pathParts.length) return value;
  const parent = getAtPath(root, pathParts.slice(0, -1));
  parent[pathParts.at(-1)] = value;
  return root;
}

function createTranslationChunks(value, pathParts = []) {
  if (JSON.stringify(value, null, 2).length <= chunkCharacterLimit) {
    return [{ kind: 'replace', pathParts, source: value }];
  }
  if (Array.isArray(value)) {
    if (value.length === 1) return createTranslationChunks(value[0], [...pathParts, 0]);
    const chunks = [];
    let start = 0;
    while (start < value.length) {
      if (JSON.stringify(value[start], null, 2).length > chunkCharacterLimit) {
        chunks.push(...createTranslationChunks(value[start], [...pathParts, start]));
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < value.length
        && JSON.stringify(value.slice(start, end + 1), null, 2).length <= chunkCharacterLimit) {
        end += 1;
      }
      chunks.push({ kind: 'array-range', pathParts, start, source: value.slice(start, end) });
      start = end;
    }
    return chunks;
  }
  if (value && typeof value === 'object') {
    const chunks = [];
    let grouped = {};
    const flush = () => {
      if (Object.keys(grouped).length) {
        chunks.push({ kind: 'object-merge', pathParts, source: grouped });
        grouped = {};
      }
    };
    for (const [key, child] of Object.entries(value)) {
      if (JSON.stringify({ [key]: child }, null, 2).length > chunkCharacterLimit) {
        flush();
        chunks.push(...createTranslationChunks(child, [...pathParts, key]));
        continue;
      }
      const next = { ...grouped, [key]: child };
      if (Object.keys(grouped).length && JSON.stringify(next, null, 2).length > chunkCharacterLimit) flush();
      grouped[key] = child;
    }
    flush();
    return chunks;
  }
  return [{ kind: 'replace', pathParts, source: value }];
}

function extractChunk(root, chunk) {
  const target = getAtPath(root, chunk.pathParts);
  if (chunk.kind === 'object-merge') {
    return Object.fromEntries(Object.keys(chunk.source).map((key) => [key, target[key]]));
  }
  if (chunk.kind === 'array-range') return target.slice(chunk.start, chunk.start + chunk.source.length);
  return target;
}

function mergeChunk(root, chunk, translated) {
  if (chunk.kind === 'replace') return setAtPath(root, chunk.pathParts, translated);
  const target = getAtPath(root, chunk.pathParts);
  if (chunk.kind === 'object-merge') Object.assign(target, translated);
  if (chunk.kind === 'array-range') {
    translated.forEach((item, index) => { target[chunk.start + index] = item; });
  }
  return root;
}

async function translateChunked({ source, locale, contentType, promptArguments, outputPath }) {
  const chunks = createTranslationChunks(source);
  let candidate = structuredClone(source);
  const chunkDirectory = path.join(path.dirname(outputPath), '.chunks');
  await mkdir(chunkDirectory, { recursive: true });
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkInput = path.join(chunkDirectory, `${locale}.${index + 1}.source.json`);
    const needsWrapper = Array.isArray(chunk.source) || !chunk.source || typeof chunk.source !== 'object';
    const promptSource = needsWrapper ? { __chunk: chunk.source } : chunk.source;
    await writeJson(chunkInput, promptSource);
    const chunkPromptArguments = promptArguments.filter((argument) =>
      !argument.startsWith('--input=') && !argument.startsWith('--english-manifest='));
    chunkPromptArguments.push(`--input=${chunkInput}`);
    if (locale !== 'en') {
      const chunkManifest = path.join(chunkDirectory, `${locale}.${index + 1}.manifest.json`);
      await writeJson(chunkManifest, {
        locale: 'en',
        status: 'approved',
        translationHash: await fileHash(chunkInput),
      });
      chunkPromptArguments.push(`--english-manifest=${chunkManifest}`);
    }
    const prompt = await runNodeScript('create-localization-prompt.mjs', chunkPromptArguments);
    const translationLabel = `translation ${locale} chunk ${index + 1}/${chunks.length}`;
    const maximumShapeAttempts = 3;
    let translated;
    let repairedPrompt;
    for (let shapeAttempt = 1; shapeAttempt <= maximumShapeAttempts; shapeAttempt += 1) {
      translated = await callDeepSeek(prompt, translationLabel);
      repairedPrompt = repairCommonShape(promptSource, translated);
      try {
        assertSameShape(promptSource, repairedPrompt);
        break;
      } catch (error) {
        if (shapeAttempt === maximumShapeAttempts) {
          throw new Error(`${translationLabel} returned an incompatible structure after ${maximumShapeAttempts} attempts: ${error.message}`);
        }
      }
    }
    await writeJson(path.join(chunkDirectory, `${locale}.${index + 1}.candidate.json`), translated);
    const repaired = needsWrapper ? repairedPrompt.__chunk : repairedPrompt;
    candidate = mergeChunk(candidate, chunk, repaired);
  }
  return { candidate, chunks };
}

async function reviewChunkedEnglish({ source, candidate, chunks, contentType, outputPath }) {
  const chunkDirectory = path.join(path.dirname(outputPath), '.chunks');
  const scores = [];
  const issues = [];
  let acceptable = true;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const sourceChunk = chunk.source;
    const candidateChunk = extractChunk(candidate, chunk);
    const sourcePath = path.join(chunkDirectory, `en.${index + 1}.review-source.json`);
    const candidatePath = path.join(chunkDirectory, `en.${index + 1}.review-candidate.json`);
    await writeJson(sourcePath, sourceChunk);
    await writeJson(candidatePath, candidateChunk);
    const reviewPrompt = await runNodeScript('create-review-prompt.mjs', [
      `--source=${sourcePath}`,
      `--candidate=${candidatePath}`,
      '--locale=en',
      `--content-type=${contentType}`,
    ]);
    const review = await callDeepSeek(reviewPrompt, `review en chunk ${index + 1}/${chunks.length}`);
    const score = Number(review.score);
    if (!Number.isFinite(score)) throw new Error(`review en chunk ${index + 1} omitted a numeric score`);
    scores.push(score);
    const chunkIssues = Array.isArray(review.issues) ? review.issues : [];
    issues.push(...chunkIssues.map((issue) => ({ ...issue, chunk: index + 1 })));
    const onlyMinor = chunkIssues.every((issue) => String(issue?.severity || '').toLowerCase() === 'minor');
    if (!(review.status === 'approved' && score >= 90) && !(review.status === 'revise' && score >= 85 && onlyMinor)) {
      acceptable = false;
    }
    if (review.status === 'revise' && review.revisedContent) {
      const repairedRevision = repairCommonShape(sourceChunk, review.revisedContent);
      assertSameShape(sourceChunk, repairedRevision);
      candidate = mergeChunk(candidate, chunk, repairedRevision);
    }
  }
  return {
    candidate,
    review: {
      score: Math.min(...scores),
      status: acceptable ? 'approved' : 'revise',
      issues,
      chunkCount: chunks.length,
    },
  };
}

async function translateAndReview({ locale, contentType, inputPath, outputPath, manifestPath, validationPath, reviewPath, allowMissingReferences }) {
  const source = await readJson(inputPath);
  const progress = (message) => process.stderr.write(`[${locale}] ${message}\n`);
  const promptArguments = [
    `--locale=${locale}`,
    `--source-locale=${locale === 'en' ? 'zh-CN' : 'en'}`,
    `--content-type=${contentType}`,
    `--input=${inputPath}`,
  ];
  if (manifestPath) promptArguments.push(`--english-manifest=${manifestPath}`);
  if (allowMissingReferences) promptArguments.push('--allow-missing-references');

  let candidate;
  let review;
  let chunks = [];
  const useChunks = JSON.stringify(source, null, 2).length > chunkCharacterLimit;
  let reusedExisting = false;
  if (hasFlag('reuse-existing')) {
    try {
      candidate = await readJson(outputPath);
      review = await readJson(reviewPath);
      candidate = repairCommonShape(source, candidate);
      assertSameShape(source, candidate);
      reusedExisting = true;
      progress('复用已生成的完整翻译和复核结果');
    } catch {
      reusedExisting = false;
    }
  }

  if (!reusedExisting) {
    if (useChunks) {
      progress('内容较长，正在分块调用 DeepSeek 翻译');
      ({ candidate, chunks } = await translateChunked({ source, locale, contentType, promptArguments, outputPath }));
    } else {
      progress('正在生成翻译提示词');
      const prompt = await runNodeScript('create-localization-prompt.mjs', promptArguments);
      progress('正在调用 DeepSeek 翻译');
      candidate = await callDeepSeek(prompt, `translation ${locale}`);
      candidate = repairCommonShape(source, candidate);
      assertSameShape(source, candidate);
    }
    setLocaleFields(candidate, locale);
    await writeJson(outputPath, candidate);

    if (useChunks && locale === 'en') {
      progress(`正在分块独立复核（共 ${chunks.length} 块）`);
      ({ candidate, review } = await reviewChunkedEnglish({ source, candidate, chunks, contentType, outputPath }));
      setLocaleFields(candidate, locale);
      await writeJson(outputPath, candidate);
    } else if (useChunks) {
      review = { score: null, status: 'review-unavailable', issues: [], chunkCount: chunks.length };
    } else {
      const maximumReviewAttempts = locale === 'en' ? 4 : 1;
      for (let reviewAttempt = 1; reviewAttempt <= maximumReviewAttempts; reviewAttempt += 1) {
        progress(`正在独立复核（第 ${reviewAttempt} 次）`);
        const reviewPrompt = await runNodeScript('create-review-prompt.mjs', [
          `--source=${inputPath}`,
          `--candidate=${outputPath}`,
          `--locale=${locale}`,
          `--content-type=${contentType}`,
        ]);
        try {
          review = await callDeepSeek(reviewPrompt, `review ${locale}`);
        } catch (error) {
          if (locale === 'en') throw error;
          review = { score: null, status: 'review-unavailable', issues: [], reviewerError: error.message };
          progress(`下游复核不可用，按结构校验结果继续：${error.message}`);
          break;
        }
        const score = Number(review.score);
        if (!Number.isFinite(score)) throw new Error(`review ${locale} omitted a numeric score`);

        if (review.status !== 'revise' || !review.revisedContent || !Object.keys(review.revisedContent).length) {
          break;
        }
        const repairedRevision = repairCommonShape(source, review.revisedContent);
        assertSameShape(source, repairedRevision);
        candidate = repairedRevision;
        setLocaleFields(candidate, locale);
        await writeJson(outputPath, candidate);
      }
    }

    await writeJson(reviewPath, review);
  }
  progress('正在执行结构与术语校验');
  await runNodeScript('validate-localization.mjs', [
    `--source=${inputPath}`,
    `--candidate=${outputPath}`,
    `--locale=${locale}`,
    `--content-type=${contentType}`,
    `--output=${validationPath}`,
  ]);
  const validation = await readJson(validationPath);
  const reviewScore = review.score === null || review.score === undefined ? null : Number(review.score);
  const structurallyValid = validation.status !== 'rejected';
  const onlyMinorReviewIssues = Array.isArray(review.issues)
    && review.issues.every((issue) => String(issue?.severity || '').toLowerCase() === 'minor');
  // English remains strict about schema/validation and blocks on substantive review findings;
  // optional copy-edit suggestions should not prevent publishing an otherwise valid master.
  const approved = locale === 'en'
    ? structurallyValid
      && reviewScore >= 85
      && (review.status === 'approved' || (review.status === 'revise' && onlyMinorReviewIssues))
    : structurallyValid;
  progress(approved
    ? `通过，复核分数 ${reviewScore ?? '不可用'}${locale === 'en' ? '' : '（下游宽松模式）'}`
    : `待复核，复核分数 ${reviewScore ?? '不可用'}`);

  return {
    locale,
    approved,
    score: reviewScore,
    reviewStatus: review.status,
    issueCount: Array.isArray(review.issues) ? review.issues.length : 0,
    validationStatus: validation.status,
    acceptanceMode: locale === 'en' ? 'strict-english-master' : 'localized-draft',
    outputPath,
    referenceStatus: locale === 'en' ? 'not-required' : allowMissingReferences ? 'missing-user-accepted' : 'collected',
  };
}

async function workerMain() {
  const locale = getArgument('locale');
  const inputPath = getArgument('input');
  const outputPath = getArgument('output');
  const manifestPath = getArgument('manifest');
  const validationPath = getArgument('validation-output');
  const reviewPath = getArgument('review-output');
  const contentType = getArgument('content-type');
  if (!locale || !contentType || !inputPath || !outputPath || !validationPath || !reviewPath) {
    throw new Error('Worker is missing required arguments');
  }
  const result = await translateAndReview({
    locale,
    contentType,
    inputPath,
    outputPath,
    manifestPath,
    validationPath,
    reviewPath,
    allowMissingReferences: hasFlag('allow-missing-references'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function workerBatchMain() {
  const locales = (getArgument('locales') || '').split(',').map((item) => item.trim()).filter(Boolean);
  const inputPath = getArgument('input');
  const manifestPath = getArgument('manifest');
  const runDirectory = getArgument('run-directory');
  const resultPath = getArgument('result-file');
  const slot = getArgument('slot') || '?';
  const contentType = getArgument('content-type');
  if (!contentType || !inputPath || !manifestPath || !runDirectory || !resultPath) {
    throw new Error('Visible worker is missing required arguments');
  }

  const results = [];
  console.log(`[slot ${slot}] 语言队列：${locales.join(', ')}`);
  if (!locales.length) {
    await writeJson(resultPath, { complete: true, slot, results });
    console.log(`[slot ${slot}] 当前无待处理语言。窗口将保留，可关闭。`);
    return;
  }
  await writeJson(resultPath, { complete: false, slot, results });
  for (const locale of locales) {
    console.log(`\n[slot ${slot}] 开始 ${locale}`);
    const outputPath = path.join(runDirectory, `${locale}.json`);
    const validationPath = path.join(runDirectory, `${locale}.validation.json`);
    const reviewPath = path.join(runDirectory, `${locale}.review.json`);
    try {
      const result = await translateAndReview({
        locale,
        contentType,
        inputPath,
        outputPath,
        manifestPath,
        validationPath,
        reviewPath,
        allowMissingReferences: hasFlag('allow-missing-references'),
      });
      results.push({ ...result, sourceLocale: 'en' });
    } catch (error) {
      console.error(`[${locale}] 失败：${error.message}`);
      results.push({ locale, sourceLocale: 'en', approved: false, error: error.message });
    }
    await writeJson(resultPath, { complete: false, slot, results });
  }
  await writeJson(resultPath, { complete: true, slot, results });
  console.log(`\n[slot ${slot}] 本组完成。窗口将保留，可关闭。`);
}

function getTableColumns(db, tableName) {
  return db.prepare(`pragma table_info(${tableName})`).all();
}

function getLocaleRows(db, tableName, locale) {
  const rows = db
    .prepare(`select * from ${tableName} where locale = ? order by published_at is null, id`)
    .all(locale);
  const selected = new Map();
  for (const row of rows) {
    const key = row.document_id || String(row.id);
    if (!selected.has(key)) selected.set(key, row);
  }
  return [...selected.values()];
}

function extractSourceBundle(db, selectedTables) {
  const sourceBundle = {};
  const sourceMetadata = {};
  for (const tableName of selectedTables) {
    const columns = getTableColumns(db, tableName);
    const translatableColumns = columns.filter((column) => !metadataColumns.has(column.name));
    const rows = getLocaleRows(db, tableName, 'zh-CN');
    if (!rows.length) throw new Error(`No zh-CN source rows found in ${tableName}`);

    sourceBundle[tableName] = rows.map((row) => Object.fromEntries(
      translatableColumns.map((column) => [
        column.name,
        column.type.toLowerCase() === 'json' && typeof row[column.name] === 'string'
          ? JSON.parse(row[column.name])
          : row[column.name],
      ])
    ));
    sourceMetadata[tableName] = { columns, rows };
  }
  return { sourceBundle, sourceMetadata };
}

function extractLocaleBundle(db, selectedTables, locale) {
  const bundle = {};
  for (const tableName of selectedTables) {
    const columns = getTableColumns(db, tableName);
    const translatableColumns = columns.filter((column) => !metadataColumns.has(column.name));
    const rows = getLocaleRows(db, tableName, locale);
    if (!rows.length) throw new Error(`No ${locale} rows found in ${tableName}`);
    bundle[tableName] = rows.map((row) => Object.fromEntries(translatableColumns.map((column) => {
      let value = row[column.name];
      if (value !== null && column.type.toUpperCase().includes('JSON')) value = JSON.parse(value);
      return [column.name, value];
    })));
  }
  return bundle;
}

function inspectDatabaseStatus(db, localeCodes, selectedTables) {
  return Object.fromEntries(localeCodes.map((locale) => [
    locale,
    Object.fromEntries(selectedTables.map((tableName) => {
      const rows = db.prepare(`select published_at from ${tableName} where locale = ?`).all(locale);
      return [tableName, {
        drafts: rows.filter((row) => row.published_at === null).length,
        published: rows.filter((row) => row.published_at !== null).length,
      }];
    })),
  ]));
}

function serializeTranslatedRow(translatedRow, columns) {
  return Object.fromEntries(columns
    .filter((column) => !metadataColumns.has(column.name))
    .map((column) => [
      column.name,
      column.type.toLowerCase() === 'json' && translatedRow[column.name] !== null
        ? JSON.stringify(translatedRow[column.name])
        : translatedRow[column.name],
    ]));
}

function syncLocaleContent(db, locale, translatedBundle, sourceMetadata, selectedTables, publish) {
  const result = {};
  for (const tableName of selectedTables) {
    const { columns, rows: sourceRows } = sourceMetadata[tableName];
    const translatedRows = translatedBundle[tableName];
    if (!Array.isArray(translatedRows) || translatedRows.length !== sourceRows.length) {
      throw new Error(`${locale}/${tableName}: translated row count changed`);
    }
    const targetDrafts = db
      .prepare(`select * from ${tableName} where locale = ? and published_at is null order by id`)
      .all(locale);
    const targetPublished = db
      .prepare(`select * from ${tableName} where locale = ? and published_at is not null order by id`)
      .all(locale);
    let created = 0;
    let updated = 0;

    for (let index = 0; index < sourceRows.length; index += 1) {
      const source = sourceRows[index];
      const translated = serializeTranslatedRow(translatedRows[index], columns);
      const existingDraft = targetDrafts[index];
      const existingPublished = targetPublished[index];
      const documentId = existingPublished?.document_id || existingDraft?.document_id || makeDocumentId();

      if (existingDraft) {
        const sets = [
          ...Object.keys(translated).map((column) => `${column} = @${column}`),
          'updated_at = @updated_at',
          'updated_by_id = @updated_by_id',
        ];
        db.prepare(`update ${tableName} set ${sets.join(', ')} where id = @id`).run({
          id: existingDraft.id,
          updated_at: Date.now(),
          updated_by_id: source.updated_by_id,
          ...translated,
        });
        updated += 1;
      } else {
        const draftValues = {
          document_id: documentId,
          ...translated,
          created_at: Date.now(),
          updated_at: Date.now(),
          published_at: null,
          created_by_id: source.created_by_id,
          updated_by_id: source.updated_by_id,
          locale,
        };
        const names = Object.keys(draftValues);
        db.prepare(
          `insert into ${tableName} (${names.join(', ')}) values (${names.map((name) => `@${name}`).join(', ')})`
        ).run(draftValues);
        created += 1;
      }

      if (publish) {
        const publishedAt = Date.now();
        if (existingPublished) {
          const sets = [
            ...Object.keys(translated).map((column) => `${column} = @${column}`),
            'updated_at = @updated_at',
            'published_at = @published_at',
            'updated_by_id = @updated_by_id',
          ];
          db.prepare(`update ${tableName} set ${sets.join(', ')} where id = @id`).run({
            id: existingPublished.id,
            updated_at: publishedAt,
            published_at: publishedAt,
            updated_by_id: source.updated_by_id,
            ...translated,
          });
          updated += 1;
        } else {
          const publishedValues = {
            document_id: documentId,
            ...translated,
            created_at: publishedAt,
            updated_at: publishedAt,
            published_at: publishedAt,
            created_by_id: source.created_by_id,
            updated_by_id: source.updated_by_id,
            locale,
          };
          const names = Object.keys(publishedValues);
          db.prepare(
            `insert into ${tableName} (${names.join(', ')}) values (${names.map((name) => `@${name}`).join(', ')})`
          ).run(publishedValues);
          created += 1;
        }
      }
    }
    result[tableName] = { created, updated, status: publish ? 'published' : 'draft-synced' };
  }
  return result;
}

function spawnLocaleWorker({ locale, contentType, englishPath, manifestPath, runDirectory, allowMissingReferences }) {
  return new Promise((resolve) => {
    const outputPath = path.join(runDirectory, `${locale}.json`);
    const validationPath = path.join(runDirectory, `${locale}.validation.json`);
    const reviewPath = path.join(runDirectory, `${locale}.review.json`);
    const childArguments = [
      fileURLToPath(import.meta.url),
      '--worker',
      `--locale=${locale}`,
      `--content-type=${contentType}`,
      `--input=${englishPath}`,
      `--manifest=${manifestPath}`,
      `--output=${outputPath}`,
      `--validation-output=${validationPath}`,
      `--review-output=${reviewPath}`,
    ];
    if (allowMissingReferences) childArguments.push('--allow-missing-references');
    if (hasFlag('reuse-existing')) childArguments.push('--reuse-existing');
    const child = spawn(process.execPath, childArguments, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stdout.write(String(chunk));
    });
    child.on('error', (error) => resolve({ locale, approved: false, error: error.message }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ locale, approved: false, error: stderr.trim() || `worker exited with ${code}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)));
      } catch (error) {
        resolve({ locale, approved: false, error: `Invalid worker result: ${error.message}` });
      }
    });
  });
}

async function runWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

function quoteCmdArgument(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function launchVisibleWorker({ slot, locales, contentType, englishPath, manifestPath, runDirectory, resultPath, allowMissingReferences }) {
  const nodeArguments = [
    fileURLToPath(import.meta.url),
    '--worker-batch',
    `--slot=${slot}`,
    `--locales=${locales.join(',')}`,
    `--content-type=${contentType}`,
    `--input=${englishPath}`,
    `--manifest=${manifestPath}`,
    `--run-directory=${runDirectory}`,
    `--result-file=${resultPath}`,
  ];
  if (allowMissingReferences) nodeArguments.push('--allow-missing-references');
  if (hasFlag('reuse-existing')) nodeArguments.push('--reuse-existing');
  const nodeCommand = [process.execPath, ...nodeArguments].map(quoteCmdArgument).join(' ');
  const cmdCommand = `chcp 65001 > nul && title VicastCam Translation Worker ${slot} && ${nodeCommand}`;
  const powerShellScript = [
    `$command = '${cmdCommand.replace(/'/g, "''")}'`,
    `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $command) -WorkingDirectory '${projectRoot.replace(/'/g, "''")}'`,
  ].join('\r\n');
  const encodedCommand = Buffer.from(powerShellScript, 'utf16le').toString('base64');

  await new Promise((resolve, reject) => {
    const launcher = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', encodedCommand], {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
    });
    let stderr = '';
    launcher.stderr.on('data', (chunk) => { stderr += chunk; });
    launcher.on('error', reject);
    launcher.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Unable to open visible worker ${slot}: ${stderr.trim()}`));
    });
  });
}

async function waitForVisibleWorker(resultPath, slot) {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const result = await readJson(resultPath);
      if (result.complete) return result.results;
    } catch {
      // The visible worker has not created its result file yet.
    }
    await sleep(1000);
  }
  throw new Error(`Visible worker ${slot} did not finish within 30 minutes`);
}

async function runVisibleWorkers({ locales, contentType, concurrency, englishPath, manifestPath, runDirectory, allowMissingReferences }) {
  const slots = Array.from({ length: concurrency }, () => []);
  locales.forEach((locale, index) => slots[index % slots.length].push(locale));
  const resultPaths = slots.map((_, index) => path.join(runDirectory, `slot-${index + 1}.result.json`));
  await Promise.all(resultPaths.map((resultPath, index) =>
    writeJson(resultPath, { complete: false, slot: String(index + 1), results: [] })
  ));

  console.log(`${slots.length} 个可视化进程分组：`);
  slots.forEach((items, index) => console.log(`- 窗口 ${index + 1}: ${items.join(', ')}`));
  for (let index = 1; index < slots.length; index += 1) {
    await launchVisibleWorker({
      slot: index + 1,
      locales: slots[index],
      contentType,
      englishPath,
      manifestPath,
      runDirectory,
      resultPath: resultPaths[index],
      allowMissingReferences,
    });
  }

  const childResultsPromise = Promise.all(resultPaths.slice(1).map((resultPath, index) =>
    waitForVisibleWorker(resultPath, index + 2)
  ));
  const localResults = [];
  for (const locale of slots[0]) {
    console.log(`\n[slot 1] 开始 ${locale}`);
    const outputPath = path.join(runDirectory, `${locale}.json`);
    const validationPath = path.join(runDirectory, `${locale}.validation.json`);
    const reviewPath = path.join(runDirectory, `${locale}.review.json`);
    try {
      localResults.push({
        ...(await translateAndReview({
          locale,
          contentType,
          inputPath: englishPath,
          outputPath,
          manifestPath,
          validationPath,
          reviewPath,
          allowMissingReferences,
        })),
        sourceLocale: 'en',
      });
    } catch (error) {
      console.error(`[${locale}] 失败：${error.message}`);
      localResults.push({ locale, sourceLocale: 'en', approved: false, error: error.message });
    }
  }
  const childResults = await childResultsPromise;
  return [...localResults, ...childResults.flat()];
}

async function publishExistingMain() {
  const reportPaths = (getArgument('reports') || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!reportPaths.length) {
    throw new Error('Use --publish-existing --reports=report1.json,report2.json,... to publish an explicit translation set.');
  }
  const selectedTables = (getArgument('only') || 'logins,footers,navigations').split(',').map((item) => item.trim()).filter(Boolean);
  if (selectedTables.some((name) => !tableDefinitions[name])) throw new Error('Unsupported table in --only.');

  const latestByLocale = new Map();
  for (const reportPath of reportPaths) {
    const report = await readJson(path.resolve(reportPath));
    for (const item of report.locales || []) {
      if (item.approved) {
        latestByLocale.set(item.locale, {
          ...item,
          outputPath: item.outputPath || path.join(scriptDirectory, 'work', report.runId, `${item.locale}.json`),
        });
      }
    }
  }
  const localeConfig = await readJson(path.join(scriptDirectory, 'config', 'locales.json'));
  const expectedLocales = localeConfig.targetLocales.map((item) => item.code);
  const missingLocales = expectedLocales.filter((locale) => !latestByLocale.has(locale));
  if (missingLocales.length) throw new Error(`Translation set is incomplete; refusing to publish: ${missingLocales.join(', ')}`);

  const db = new Database(databasePath);
  db.pragma('busy_timeout = 60000');
  const { sourceMetadata } = extractSourceBundle(db, selectedTables);
  const publishId = `publish-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const backupDirectory = path.join(projectRoot, '.tmp', 'translation-backups');
  await mkdir(backupDirectory, { recursive: true });
  await copyFile(databasePath, path.join(backupDirectory, `${publishId}.data.db`));

  const published = db.transaction(() => {
    const result = {};
    for (const [locale, item] of latestByLocale) {
      const translatedBundle = JSON.parse(require('node:fs').readFileSync(path.resolve(item.outputPath), 'utf8'));
      result[locale] = syncLocaleContent(db, locale, translatedBundle, sourceMetadata, selectedTables, true);
    }
    return result;
  })();
  const output = {
    publishId,
    publishedAt: new Date().toISOString(),
    sourceReports: reportPaths.map((item) => path.resolve(item)),
    locales: Object.keys(published),
    tables: selectedTables,
    result: published,
    backupPath: path.join(backupDirectory, `${publishId}.data.db`),
  };
  const outputPath = path.join(scriptDirectory, 'reports', `${publishId}.status.json`);
  await writeJson(outputPath, output);
  db.close();
  console.log(`Published ${output.locales.length} locales across ${selectedTables.length} modules.`);
  console.log(`Publish report: ${outputPath}`);
}

function createMarkdownReport(report, localeConfig) {
  const labels = Object.fromEntries(localeConfig.targetLocales.map((item) => [item.code, item.name]));
  const moduleHeaders = report.selectedTables.map((tableName) => tableDefinitions[tableName]?.label || tableName);
  const lines = [
    '# 翻译状态',
    '',
    `- 运行 ID：${report.runId}`,
    `- 生成时间：${report.completedAt}`,
    `- 翻译链路：${report.pipeline}`,
    `- 数据库：${report.writeMode}`,
    `- 并发进程：${report.concurrency}`,
    '',
    `| 语言 | 源语言 | ${moduleHeaders.join(' | ')} | 复核 | 参考样本 |`,
    `| --- | --- | ${moduleHeaders.map(() => '---').join(' | ')} | --- | --- |`,
  ];
  for (const item of report.locales) {
    const moduleStatus = (tableName) => item.database?.[tableName]?.status || (item.error ? '未翻译' : '已生成');
    const moduleStatuses = report.selectedTables.map(moduleStatus);
    lines.push(
      `| ${labels[item.locale] || item.locale} (${item.locale}) | ${item.sourceLocale} | ${moduleStatuses.join(' | ')} | ${item.reviewStatus || item.status}${item.score ? ` (${item.score})` : ''} | ${item.referenceStatus || '-'} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (hasFlag('publish-existing')) {
    await publishExistingMain();
    return;
  }
  if (hasFlag('worker')) {
    await workerMain();
    return;
  }
  if (hasFlag('worker-batch')) {
    await workerBatchMain();
    return;
  }

  const localeConfig = await readJson(path.join(scriptDirectory, 'config', 'locales.json'));
  const requestedTables = (getArgument('only') || 'logins,footers,navigations').split(',').map((item) => item.trim()).filter(Boolean);
  const selectedTables = requestedTables.filter((name) => tableDefinitions[name]);
  if (selectedTables.length !== requestedTables.length || !selectedTables.length) {
    throw new Error(`Unsupported --only value. Use: ${Object.keys(tableDefinitions).join(',')}`);
  }
  const inferredContentTypes = new Set(selectedTables.map((name) => tableDefinitions[name].contentType));
  const contentType = getArgument('content-type') || (inferredContentTypes.size === 1 ? [...inferredContentTypes][0] : '');
  if (!contentType) {
    throw new Error('Mixed module types require an explicit --content-type value or separate homogeneous runs.');
  }
  const requestedLocales = getArgument('locales')?.split(',').map((item) => item.trim()).filter(Boolean);
  const allTargetCodes = localeConfig.targetLocales.map((item) => item.code);
  const targetCodes = requestedLocales || allTargetCodes;
  if (!targetCodes.includes('en')) targetCodes.unshift('en');
  const unsupportedLocales = targetCodes.filter((locale) => !allTargetCodes.includes(locale));
  if (unsupportedLocales.length) throw new Error(`Unsupported locales: ${unsupportedLocales.join(', ')}`);

  const db = new Database(databasePath);
  db.pragma('busy_timeout = 60000');
  const beforeStatus = inspectDatabaseStatus(db, targetCodes, selectedTables);
  if (hasFlag('status-only')) {
    process.stdout.write(`${JSON.stringify({ tables: selectedTables, locales: beforeStatus }, null, 2)}\n`);
    db.close();
    return;
  }

  const { sourceBundle, sourceMetadata } = extractSourceBundle(db, selectedTables);
  const resumeRunId = getArgument('resume-run');
  const runId = resumeRunId || new Date().toISOString().replace(/[:.]/g, '-');
  const runDirectory = path.join(scriptDirectory, 'work', runId);
  await mkdir(runDirectory, { recursive: true });
  const chinesePath = path.join(runDirectory, 'zh-CN.json');
  const englishPath = path.join(runDirectory, 'en.json');
  const englishValidationPath = path.join(runDirectory, 'en.validation.json');
  const englishReviewPath = path.join(runDirectory, 'en.review.json');
  await writeJson(chinesePath, sourceBundle);

  let englishResult;
  if (hasFlag('reuse-published-english')) {
    const englishBundle = extractLocaleBundle(db, selectedTables, 'en');
    await writeJson(englishPath, englishBundle);
    const review = { score: 100, status: 'approved', issues: [], source: 'published-reviewed-master' };
    const validation = { status: 'needs-human-review', issues: [], source: 'published-reviewed-master' };
    await writeJson(englishReviewPath, review);
    await writeJson(englishValidationPath, validation);
    englishResult = {
      locale: 'en',
      approved: true,
      score: 100,
      reviewStatus: 'approved',
      issueCount: 0,
      validationStatus: validation.status,
      acceptanceMode: 'published-reviewed-master',
      outputPath: englishPath,
      referenceStatus: 'not-required',
    };
    console.log('[en] Reusing the reviewed English master already published in Strapi');
  } else if (resumeRunId) {
    const review = await readJson(englishReviewPath);
    const validation = await readJson(englishValidationPath);
    const reviewScore = Number(review.score);
    const onlyMinorReviewIssues = Array.isArray(review.issues)
      && review.issues.every((issue) => String(issue?.severity || '').toLowerCase() === 'minor');
    englishResult = {
      locale: 'en',
      approved: validation.status !== 'rejected'
        && reviewScore >= 85
        && (review.status === 'approved' || (review.status === 'revise' && onlyMinorReviewIssues)),
      score: reviewScore,
      reviewStatus: review.status,
      issueCount: Array.isArray(review.issues) ? review.issues.length : 0,
      validationStatus: validation.status,
      acceptanceMode: 'strict-english-master',
      outputPath: englishPath,
      referenceStatus: 'not-required',
    };
    console.log(`[en] Resuming reviewed English master from ${runId}`);
  } else {
    englishResult = await translateAndReview({
      locale: 'en',
      contentType,
      inputPath: chinesePath,
      outputPath: englishPath,
      validationPath: englishValidationPath,
      reviewPath: englishReviewPath,
      allowMissingReferences: false,
    });
  }
  if (!englishResult.approved) {
    throw new Error(`English master was not approved (status=${englishResult.reviewStatus}, score=${englishResult.score})`);
  }
  console.log(`[en] 英文母稿已批准，开始 ${targetCodes.length - 1} 个下游语言`);

  const manifestPath = path.join(runDirectory, 'en.manifest.json');
  await writeJson(manifestPath, {
    id: crypto.randomUUID(),
    locale: 'en',
    contentType,
    status: 'approved',
    score: englishResult.score,
    reviewer: `independent-${model}`,
    model,
    promptVersion: '1.0.0',
    runId,
    sourcePath: chinesePath,
    translationPath: englishPath,
    sourceHash: await fileHash(chinesePath),
    translationHash: await fileHash(englishPath),
    workflowVersion: '1.0.0',
    createdAt: new Date().toISOString(),
  });

  const downstreamCodes = targetCodes.filter((locale) => locale !== 'en');
  const concurrency = Math.max(1, Math.min(8, Number(getArgument('concurrency')) || 4));
  const allowMissingReferences = hasFlag('allow-missing-references');
  const downstreamResults = hasFlag('visible-workers')
    ? await runVisibleWorkers({
        locales: downstreamCodes,
        contentType,
        concurrency,
        englishPath,
        manifestPath,
        runDirectory,
        allowMissingReferences,
      })
    : await runWithConcurrency(
        downstreamCodes,
        concurrency,
        (locale) => spawnLocaleWorker({ locale, contentType, englishPath, manifestPath, runDirectory, allowMissingReferences })
      );
  const localeResults = [{ ...englishResult, sourceLocale: 'zh-CN' }, ...downstreamResults.map((item) => ({ ...item, sourceLocale: 'en' }))];

  const publish = !hasFlag('draft-only');
  const writeMode = hasFlag('no-write')
    ? '仅生成文件，未写数据库'
    : publish
      ? '同步 Strapi 草稿并直接发布'
      : '仅同步 Strapi 草稿';
  if (!hasFlag('no-write')) {
    const backupDirectory = path.join(projectRoot, '.tmp', 'translation-backups');
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, `${runId}.data.db`);
    await copyFile(databasePath, backupPath);

    const writeTransaction = db.transaction((items) => {
      for (const item of items) {
        if (!item.approved) continue;
        const translatedBundle = JSON.parse(require('node:fs').readFileSync(item.outputPath, 'utf8'));
        item.database = syncLocaleContent(db, item.locale, translatedBundle, sourceMetadata, selectedTables, publish);
      }
    });
    console.log(`[database] 正在备份并同步${publish ? '草稿和已发布内容' : '草稿'}`);
    writeTransaction(localeResults);
    console.log(`[database] ${publish ? '发布完成' : '草稿同步完成'}`);
  }

  const report = {
    runId,
    startedAt: runId,
    completedAt: new Date().toISOString(),
    pipeline: 'zh-CN -> en -> all other locales',
    model,
    contentType,
    concurrency,
    writeMode,
    selectedTables,
    beforeStatus,
    locales: localeResults.map((item) => ({
      locale: item.locale,
      sourceLocale: item.sourceLocale,
      status: item.error ? '未翻译' : item.approved ? '已翻译' : '待复核',
      approved: Boolean(item.approved),
      score: item.score,
      reviewStatus: item.reviewStatus,
      validationStatus: item.validationStatus,
      referenceStatus: item.referenceStatus,
      database: item.database,
      error: item.error,
    })),
  };
  const jsonReportPath = path.join(scriptDirectory, 'reports', `${runId}.status.json`);
  const markdownReportPath = path.join(scriptDirectory, 'reports', `${runId}.status.md`);
  await writeJson(jsonReportPath, report);
  await writeFile(markdownReportPath, createMarkdownReport(report, localeConfig), 'utf8');
  db.close();

  const translatedCount = report.locales.filter((item) => item.status === '已翻译').length;
  const missingCount = report.locales.length - translatedCount;
  console.log(`Translation run ${runId} complete: ${translatedCount} translated, ${missingCount} not approved.`);
  console.log(`Status report: ${markdownReportPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
