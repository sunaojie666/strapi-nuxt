const crypto = require('crypto');
const Database = require('better-sqlite3');
require('dotenv').config({ path: '.env' });

const db = new Database('.tmp/data.db');
db.pragma('busy_timeout = 60000');
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const deepseekApiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const forceSync = process.argv.includes('--force');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlyTables = onlyArg
  ? new Set(
      onlyArg
        .slice('--only='.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    )
  : null;
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const onlyLocales = targetArg
  ? new Set(
      targetArg
        .slice('--target='.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    )
  : null;
const sourceHashStoreKey = 'custom_i18n_zh_cn_source_hash';
const translationRequestTimeoutMs = 60000;

const allTables = [
  { name: 'homes', type: 'api::home.home' },
  { name: 'abouts', type: 'api::about.about' },
  { name: 'downloads', type: 'api::download.download' },
  { name: 'navigations', type: 'api::navigation.navigation' },
  { name: 'features', type: 'api::feature.feature' },
  { name: 'pricings', type: 'api::pricing.pricing' },
  { name: 'checkouts', type: 'api::checkout.checkout' },
  { name: 'privacys', type: 'api::privacy.privacy' },
  { name: 'agreements', type: 'api::agreement.agreement' },
  { name: 'members', type: 'api::member.member' },
  { name: 'gdprs', type: 'api::gdpr.gdpr' },
  { name: 'safetys', type: 'api::safety.safety' },
  { name: 'refunds', type: 'api::refund.refund' },
  { name: 'faqs', type: 'api::faq.faq' },
  { name: 'tutorials', type: 'api::tutorial.tutorial' },
  { name: 'cards', type: 'api::card.card' },
  { name: 'streamers', type: 'api::streamer.streamer' },
  { name: 'communitys', type: 'api::community.community' },
  { name: 'footers', type: 'api::footer.footer' },
  { name: 'teams', type: 'api::team.team' },
  { name: 'forms', type: 'api::form.form' },
  { name: 'logins', type: 'api::login.login' },
  { name: 'profiles', type: 'api::profile.profile' },
  { name: 'virtuals', type: 'api::virtual.virtual' },
  { name: 'sdks', type: 'api::sdk.sdk' },
  { name: 'cameras', type: 'api::camera.camera' },
  { name: 'soundcards', type: 'api::soundcard.soundcard' },
  { name: 'examples', type: 'api::example.example' },
];
const tables = onlyTables ? allTables.filter((table) => onlyTables.has(table.name)) : allTables;
const isAboutWebsiteTranslation = tables.length === 1 && tables[0].name === 'abouts';
const isTeamWebsiteTranslation = tables.length === 1 && tables[0].name === 'teams';
const isSoundcardWebsiteTranslation = tables.length === 1 && tables[0].name === 'soundcards';
const isStructuredWebsiteTranslation = isAboutWebsiteTranslation || isTeamWebsiteTranslation;
const structuredWebsiteColumn = isAboutWebsiteTranslation ? 'about_box' : 'data';

if (onlyTables && tables.length === 0) {
  throw new Error(`No matching tables for --only=${Array.from(onlyTables).join(',')}`);
}

const allTargets = [
  ['en', 'en'],
  ['ja', 'ja'],
  ['zh-TW', 'zh-TW'],
  ['id', 'id'],
  ['ms', 'ms'],
  ['th', 'th'],
  ['vi', 'vi'],
  ['fil', 'tl'],
  ['es', 'es'],
  ['pt', 'pt'],
  ['ar', 'ar'],
  ['tr', 'tr'],
  ['it', 'it'],
  ['de', 'de'],
  ['fr', 'fr'],
  ['ko', 'ko'],
  ['ru', 'ru'],
  ['pl', 'pl'],
  ['nl', 'nl'],
  ['hi', 'hi'],
  ['ur', 'ur'],
  ['bn', 'bn'],
  ['fa', 'fa'],
].map(([locale, translateCode]) => ({ locale, translateCode }));
const targets = onlyLocales ? allTargets.filter((target) => onlyLocales.has(target.locale)) : allTargets;

const translationLanguageNames = {
  en: 'English',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese',
  id: 'Indonesian',
  ms: 'Malay',
  th: 'Thai',
  vi: 'Vietnamese',
  tl: 'Filipino (Tagalog)',
  es: 'Spanish',
  pt: 'Portuguese',
  ar: 'Arabic',
  tr: 'Turkish',
  it: 'Italian',
  de: 'German',
  fr: 'French',
  ko: 'Korean',
  ru: 'Russian',
  pl: 'Polish',
  nl: 'Dutch',
  hi: 'Hindi',
  ur: 'Urdu',
  bn: 'Bengali',
  fa: 'Persian',
};

if (onlyLocales && targets.length === 0) {
  throw new Error(`No matching locales for --target=${Array.from(onlyLocales).join(',')}`);
}

const protectedTerms = [
  '$30,000 USD',
  'VicastCam',
  'business@vicastcam.com',
  'App Store',
  'Google Play',
  'YouTube',
  'Twitch',
  'TikTok',
  'Facebook Live',
  'Instagram',
  'Android',
  'WhatsApp',
  'Reddit',
  'Logo',
  'OEM',
  'MCN',
  'USD',
  'GMT+8',
  'UI',
  'iPhone',
  'Windows',
  'USB',
  'SDK',
  'API',
  'APP',
  'PC',
  'AI',
  'iOS',
];

const navigationBrandOverride = {
  source: '维卡斯特',
  defaultTarget: 'VicastCam',
  targetByLocale: {
    'zh-TW': '維卡斯特',
  },
};

const streamerFollowersOverride = {
  '5万粉丝': '50k',
  '5萬粉絲': '50k',
  '10万粉丝': '100k',
  '10萬粉絲': '100k',
};

const cache = new Map();
const sourceStrings = new Set();

const soundcardTextOverrides = {
  SDK使用须知: {
    ja: 'SDK利用上の注意',
  },
  'SDK 使用须知': {
    ja: 'SDK 利用上の注意',
  },
  运行中: {
    ms: 'Sedang berjalan',
  },
  运行: {
    ms: 'Sedang berjalan',
  },
};

const manualTextOverrides = {
  getVerifyCodeText: {
    ar: 'إرسال الرمز',
    bn: 'কোড নিন',
    de: 'Code holen',
    en: 'Get code',
    es: 'Obtener código',
    fa: 'دریافت کد',
    fil: 'Kunin code',
    fr: 'Obtenir code',
    hi: 'कोड लें',
    id: 'Ambil kode',
    it: 'Ottieni codice',
    ja: 'コード取得',
    ko: '코드 받기',
    ms: 'Dapatkan kod',
    nl: 'Code ophalen',
    pl: 'Pobierz kod',
    pt: 'Obter código',
    ru: 'Получить код',
    th: 'รับรหัส',
    tr: 'Kodu al',
    ur: 'کوڈ لیں',
    vi: 'Lấy mã',
    'zh-CN': '获取验证码',
    'zh-TW': '取得驗證碼',
  },
};

const aboutTextOverrides = {
  fil: {
    'hero.titleMain': 'Mobile Green Screen Effects at Screen Mirroring Technology',
    'hero.titleHighlight': 'Ang Product Team sa Likod Nito',
  },
  hi: {
    'hero.titleMain': 'मोबाइल ग्रीन स्क्रीन इफेक्ट्स और स्क्रीन कास्टिंग तकनीक',
    'hero.titleHighlight': 'इसके पीछे की प्रोडक्ट टीम',
  },
  it: {
    'hero.secondaryButtonText': "Scopri l'SDK",
  },
  ja: {
    'hero.titleMain': 'スマートフォン向けグリーンバックエフェクトと画面ミラーリング技術',
    'hero.titleHighlight': 'それを支えるプロダクトチーム',
  },
  ru: {
    'hero.secondaryButtonText': 'Посмотреть SDK',
  },
  th: {
    'hero.secondaryButtonText': 'ดู SDK',
  },
  ur: {
    'hero.titleMain': 'موبائل گرین اسکرین ایفیکٹس اور اسکرین کاسٹنگ ٹیکنالوجی',
    'hero.titleHighlight': 'اس کے پیچھے پروڈکٹ ٹیم',
  },
};

const hasChinese = (value) => /[\u3400-\u9fff]/.test(value);
const makeDocumentId = () => crypto.randomBytes(18).toString('base64url').slice(0, 24).toLowerCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanupGeneratedText(value) {
  if (typeof value !== 'string') {
    return value;
  }

  let cleaned = value.replace(/\[\[[^\]]+\]\]\s*/g, '').trim();

  protectedTerms.forEach((term, index) => {
    cleaned = cleaned
      .split(`ZXTRM${index}ZX`)
      .join(term)
      .split(`ZXTERM${index}ZX`)
      .join(term);
  });

  return cleaned;
}

function cleanupGeneratedValue(value) {
  if (Array.isArray(value)) {
    return value.map(cleanupGeneratedValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanupGeneratedValue(item)]));
  }

  return cleanupGeneratedText(value);
}

function cleanupGeneratedDatabaseText() {
  const tx = db.transaction(() => {
    for (const table of tables) {
      const columns = db
        .prepare(`pragma table_info(${table.name})`)
        .all()
        .filter((column) => /varchar|json|text/i.test(column.type));
      const rows = db.prepare(`select id, ${columns.map((column) => column.name).join(', ')} from ${table.name}`).all();

      for (const row of rows) {
        const updates = {};

        for (const column of columns) {
          const value = row[column.name];
          if (typeof value !== 'string') {
            continue;
          }

          if (column.type.toLowerCase() === 'json') {
            const cleanedJson = JSON.stringify(cleanupGeneratedValue(JSON.parse(value)));
            if (cleanedJson !== value) {
              updates[column.name] = cleanedJson;
            }
          } else {
            const cleanedText = cleanupGeneratedText(value);
            if (cleanedText !== value) {
              updates[column.name] = cleanedText;
            }
          }
        }

        const keys = Object.keys(updates);
        if (keys.length > 0) {
          const sets = keys.map((key) => `${key} = @${key}`).join(', ');
          db.prepare(`update ${table.name} set ${sets}, updated_at = @updated_at where id = @id`).run({
            id: row.id,
            updated_at: Date.now(),
            ...updates,
          });
        }
      }
    }
  });

  tx();
}

function getSourceContentSnapshot() {
  const snapshot = {};

  for (const table of tables) {
    const columns = db
      .prepare(`pragma table_info(${table.name})`)
      .all()
      .map((column) => column.name)
      .filter((name) => !['id', 'created_at', 'updated_at', 'created_by_id', 'updated_by_id'].includes(name));

    const rows = db
      .prepare(`select ${columns.join(', ')} from ${table.name} where locale = 'zh-CN' order by document_id, published_at is null, id`)
      .all();

    const mediaRows = db
      .prepare(
        `
        select m.file_id, m.related_type, m.field, m."order", s.document_id, s.published_at
        from files_related_mph m
        join ${table.name} s on s.id = m.related_id
        where s.locale = 'zh-CN' and m.related_type = ?
        order by s.document_id, s.published_at is null, m.field, m."order", m.file_id
      `
      )
      .all(table.type);

    snapshot[table.name] = { rows, mediaRows };
  }

  return JSON.stringify(snapshot);
}

function getSourceHash() {
  return crypto.createHash('sha256').update(getSourceContentSnapshot()).digest('hex');
}

function getStoredSourceHash() {
  const row = db.prepare('select value from strapi_core_store_settings where key = ?').get(sourceHashStoreKey);
  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setStoredSourceHash(hash) {
  const existing = db.prepare('select id from strapi_core_store_settings where key = ?').get(sourceHashStoreKey);

  if (existing) {
    db.prepare('update strapi_core_store_settings set value = ? where key = ?').run(
      JSON.stringify(hash),
      sourceHashStoreKey
    );
    return;
  }

  db.prepare('insert into strapi_core_store_settings (key, value, type, environment, tag) values (?, ?, ?, ?, ?)').run(
    sourceHashStoreKey,
    JSON.stringify(hash),
    'string',
    null,
    null
  );
}

function protectTerms(text, preserveNonChinese = false) {
  let protectedText = text;
  const replacements = [];

  protectedTerms.forEach((term, index) => {
    if (!protectedText.includes(term)) {
      return;
    }

    const token = `ZXTRM${index}ZX`;
    protectedText = protectedText.split(term).join(token);
    replacements.push([token, term]);
  });

  if (preserveNonChinese) {
    let rawIndex = 0;
    protectedText = protectedText.replace(/[^\u3400-\u9fff]+/g, (value) => {
      const token = `ZXRAW${rawIndex}ZX`;
      rawIndex += 1;
      replacements.push([token, value]);
      return token;
    });
  } else if (isAboutWebsiteTranslation) {
    protectedText = protectedText.replace(/\r?\n/g, (value) => {
      const token = `ZXBR${replacements.length}ZX`;
      replacements.push([token, value]);
      return token;
    });
  }

  return { protectedText, replacements };
}

function restoreTerms(text, replacements) {
  return [...replacements]
    .reverse()
    .reduce((result, [token, term]) => result.split(token).join(term), text);
}

async function fetchSourceTranslation(text, translateCode) {
  const { protectedText, replacements } = protectTerms(text, !isAboutWebsiteTranslation);
  const marker = '[[0]]';
  const translated = await fetchTranslation(`${marker} ${protectedText}`, translateCode);
  const cleaned = translated
    .replace(marker, '')
    .replace(/^\s*\[?\[?0\]?\]?\s*[.)、:-]?\s*/, '')
    .trim();
  const restored = restoreTerms(cleaned, replacements);
  if (/ZX(?:TRM|TERM|RAW|BR)\d*ZX/.test(restored)) {
    throw new Error('Translation contains an unrestored protection placeholder');
  }
  return restored;
}

function shouldTranslateSoundcardWholeString(text, fieldName) {
  if (!isSoundcardWebsiteTranslation || ['code', 'codeSamples'].includes(fieldName) || text.includes('\n')) {
    return false;
  }

  const protectedSegmentCount = (text.match(/[^\u3400-\u9fff]+/g) || []).length;
  return text.length <= 160 && protectedSegmentCount <= 6;
}

function collectString(text, translateWholeString = false) {
  if (text && typeof text === 'string' && hasChinese(text)) {
    if (isAboutWebsiteTranslation || translateWholeString) {
      sourceStrings.add(text);
      return;
    }

    for (const match of text.matchAll(/[\u3400-\u9fff]+/g)) {
      sourceStrings.add(match[0]);
    }
  }
}

function collectJsonStrings(value, fieldName = null) {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonStrings(item, fieldName));
    return;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (key !== 'locale') {
        collectJsonStrings(item, key);
      }
    });
    return;
  }

  const translateWholeString = shouldTranslateSoundcardWholeString(value, fieldName);
  collectString(value, translateWholeString);
}

function collectRowStrings(source, columns) {
  for (const column of columns) {
    if (
      ['id', 'document_id', 'created_at', 'updated_at', 'published_at', 'created_by_id', 'updated_by_id', 'locale'].includes(
        column.name
      )
    ) {
      continue;
    }

    const value = source[column.name];
    if (value === null || value === undefined) {
      continue;
    }

    if (column.type.toLowerCase() === 'json') {
      collectJsonStrings(JSON.parse(value));
    } else {
      collectString(value);
    }
  }
}

async function fetchTranslation(text, translateCode) {
  if (!text || typeof text !== 'string' || !hasChinese(text)) {
    return text;
  }

  const cacheKey = `${translateCode}\n${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const { protectedText, replacements } = protectTerms(text);
  const targetLanguage = translationLanguageNames[translateCode] || translateCode;
  const contentContext = isAboutWebsiteTranslation
    ? [
        'These lines are public-facing copy for the VicastCam About Us page.',
        `Localize them in the natural, polished style used by professional technology-company websites for ${targetLanguage}-speaking audiences.`,
        'Prefer idiomatic local website language over literal Chinese phrasing, while preserving every fact, claim, number, product capability, and technical meaning.',
        'Keep headings concise and compelling, body copy fluent and credible, calls to action conventional for the locale, and SEO copy natural and search-friendly.',
      ]
    : [
        'These lines come from professional VicastCam SDK documentation and SDK demo-download content.',
        'Translate accurately, completely, and naturally. Preserve the exact technical meaning and use consistent SDK terminology.',
      ];
  const prompt = [
    `Translate the following numbered Chinese lines into ${targetLanguage} (locale ${translateCode}).`,
    ...contentContext,
    'Do not omit, summarize, simplify, embellish, or reinterpret any content.',
    'Return only the translated lines, preserving every [[number]] marker exactly and keeping the same line order.',
    'Translate Chinese text only. Keep all existing non-Chinese text, source code, identifiers, paths, filenames, URLs, and formatting exactly unchanged.',
    'Do not return English unless English is the requested target language or the source text is an existing protected English term.',
    'Do not add explanations, markdown fences, or extra markers.',
    protectedText,
  ].join('\n');
  let retryFeedback = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), translationRequestTimeoutMs);

    try {
      const res = await fetch(deepseekApiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: deepseekModel,
          temperature: 0,
          max_tokens: 8192,
          messages: [
            {
              role: 'system',
              content: isAboutWebsiteTranslation
                ? 'You are a senior website localization editor for an international technology brand. Produce accurate, culturally natural, publication-ready website copy in the requested locale. Preserve facts, product terminology, formatting, and protected content. Never guess, omit, or add claims.'
                : 'You are a meticulous professional SDK and technical-documentation translator. Accuracy, completeness, terminology consistency, and preservation of protected technical content are mandatory. Never guess, omit, summarize, or rewrite the source meaning.',
            },
            { role: 'user', content: retryFeedback ? `${prompt}\n\n${retryFeedback}` : prompt },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const translated = restoreTerms(body.choices?.[0]?.message?.content?.trim() || '', replacements);
      if (!translated) {
        throw new Error('DeepSeek returned an empty translation');
      }
      if (!['ja', 'zh-TW'].includes(translateCode) && hasChinese(translated)) {
        retryFeedback = [
          'Correction required: the previous response below still contained untranslated Chinese characters.',
          `Return the complete corrected translation in ${targetLanguage}, with no Chinese characters remaining.`,
          'Preserve all numbered markers and protected ZX tokens exactly.',
          'Previous response:',
          translated,
        ].join('\n');
        throw new Error('DeepSeek response still contains Chinese text');
      }
      cache.set(cacheKey, translated);
      return translated;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Translation failed for locale ${translateCode} after 3 attempts: ${error.message}`);
      }
      await sleep(300 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateAboutTranslation(source, translated, translateCode, path = 'aboutBox') {
  if (Array.isArray(source)) {
    if (!Array.isArray(translated) || translated.length !== source.length) {
      throw new Error(`${path} array structure changed`);
    }
    source.forEach((item, index) => validateAboutTranslation(item, translated[index], translateCode, `${path}[${index}]`));
    return;
  }

  if (source && typeof source === 'object') {
    if (!translated || typeof translated !== 'object' || Array.isArray(translated)) {
      throw new Error(`${path} object structure changed`);
    }
    const sourceKeys = Object.keys(source);
    const translatedKeys = Object.keys(translated);
    if (sourceKeys.length !== translatedKeys.length || sourceKeys.some((key) => !translatedKeys.includes(key))) {
      throw new Error(`${path} keys changed`);
    }
    sourceKeys.forEach((key) => {
      const childPath = `${path}.${key}`;
      const mustRemainExact =
        ['year', 'key', 'href', 'name', 'image', 'icon', 'slug'].includes(key) ||
        (key === 'value' && typeof source[key] === 'string' && !hasChinese(source[key]));
      if (mustRemainExact && translated[key] !== source[key]) {
        throw new Error(`${childPath} must remain exactly ${JSON.stringify(source[key])}`);
      }
      validateAboutTranslation(source[key], translated[key], translateCode, childPath);
    });
    return;
  }

  if (typeof source !== typeof translated) {
    throw new Error(`${path} value type changed`);
  }

  if (typeof source !== 'string') {
    return;
  }

  if (/\[\[\d+\]\]|ZX(?:TRM|TERM|RAW|BR)\d*ZX/.test(translated)) {
    throw new Error(`${path} contains a translation placeholder`);
  }
  if (!['ja', 'zh-TW'].includes(translateCode) && hasChinese(translated)) {
    throw new Error(`${path} still contains Chinese text`);
  }
  protectedTerms.filter((term) => term !== 'AI').forEach((term) => {
    if (source.includes(term) && !translated.includes(term)) {
      throw new Error(`${path} must preserve ${term}`);
    }
  });
}

function normalizeTeamTranslation(value, locale) {
  if (!isTeamWebsiteTranslation) {
    return value;
  }

  const fields = value?.application?.fields;
  if (!Array.isArray(fields)) {
    return value;
  }

  for (const field of fields) {
    if (['contactName', 'email'].includes(field?.name) && typeof field.label === 'string') {
      field.label = field.label.replace(/\s*[*\uFF0A]\s*$/u, '');
    }
  }

  if (locale === 'pt' && value?.plans?.items?.[0]) {
    value.plans.items[0].description =
      'Destinado a lojas de software para vendas internacionais, lojas de equipamentos para transmiss\u00f5es ao vivo, MCNs internacionais e equipes de com\u00e9rcio eletr\u00f4nico transfronteiri\u00e7o, com distribui\u00e7\u00e3o em volume de licen\u00e7as de software.';
  }

  return value;
}

function validateTeamTranslation(source, translated) {
  if (!isTeamWebsiteTranslation) {
    return;
  }

  const sourceFields = source?.application?.fields || [];
  const translatedFields = translated?.application?.fields || [];
  const sourceCountries = sourceFields.find((field) => field.name === 'country')?.options || [];
  const translatedCountries = translatedFields.find((field) => field.name === 'country')?.options || [];

  if (translatedCountries.length !== sourceCountries.length) {
    throw new Error(
      `application.fields.country.options must contain all ${sourceCountries.length} source options in the same order`
    );
  }

  for (const name of ['contactName', 'email']) {
    const label = translatedFields.find((field) => field.name === name)?.label;
    if (typeof label !== 'string' || /[*\uFF0A]/u.test(label)) {
      throw new Error(`application.fields.${name}.label must not contain an asterisk`);
    }
  }
}

function applyAboutTextOverrides(value, locale) {
  if (!isAboutWebsiteTranslation) {
    return value;
  }

  const overrides = aboutTextOverrides[locale];
  if (!overrides) {
    return value;
  }

  for (const [path, text] of Object.entries(overrides)) {
    const keys = path.split('.');
    const target = keys.slice(0, -1).reduce((item, key) => item[key], value);
    target[keys[keys.length - 1]] = text;
  }
  return value;
}

async function fetchAboutJsonTranslation(source, target) {
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const targetLanguage = translationLanguageNames[target.translateCode] || target.translateCode;
  const sourceJson = JSON.stringify(source, null, 2);
  const { protectedText: protectedSourceJson, replacements } = protectTerms(sourceJson);
  const pageName = isTeamWebsiteTranslation ? 'Business Partnership page' : 'About Us page';
  const pageGuidance = isTeamWebsiteTranslation
    ? [
        'Use credible, commercially precise B2B website language for prospective distributors, resellers, OEM partners, and enterprise customers.',
        'Localize partnership benefits, eligibility and settlement rules, channel support, cooperation plans, application-form labels, country options, contact details, and SEO copy using terminology conventional in the target market.',
        'Keep financial thresholds and USD amounts exact. Keep field name values, asset paths, URLs, email addresses, phone numbers, brand names, and technical terms unchanged.',
        'Translate every country/region option from the source in the exact same order; do not omit, merge, or shorten the options array.',
        'The contactName and email field labels must not contain a normal or full-width asterisk.',
      ]
    : [
        'Treat hero.titleMain and hero.titleHighlight as two consecutive parts of one headline: make them complementary, concise, and non-duplicative.',
        'Use conventional local wording for eyebrow labels, section headings, calls to action, product milestones, social copy, and SEO metadata.',
      ];
  const prompt = [
    `Localize the following VicastCam ${pageName} JSON from Simplified Chinese into ${targetLanguage} (locale ${target.locale}).`,
    'Return one valid JSON object only. Preserve the exact object keys, array order, data types, URLs, item keys, years, statistics, line breaks, and factual meaning.',
    'Write polished, publication-ready copy in the natural style of a professional technology-company website for the target locale; avoid literal Chinese syntax and awkward machine-translation phrasing.',
    ...pageGuidance,
    'Preserve VicastCam and all existing Latin technical terms such as SDK, AI, PC, 3D, YouTube, URLs, and numeric claims exactly. Add normal spacing around those terms when the target language requires it.',
    'Do not add claims, company details, explanations, markdown fences, placeholders, or fields that are absent from the source.',
    protectedSourceJson,
  ].join('\n');
  let correction = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), translationRequestTimeoutMs);

    try {
      const res = await fetch(deepseekApiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: deepseekModel,
          temperature: 0,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You are a senior website localization editor and JSON content specialist. Produce accurate, culturally natural, publication-ready technology-brand copy while preserving the supplied JSON contract and every factual detail.',
            },
            { role: 'user', content: correction ? `${prompt}\n\nCorrection required:\n${correction}` : prompt },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const content = body.choices?.[0]?.message?.content?.trim() || '';
      if (!content) {
        throw new Error('DeepSeek returned an empty translation');
      }
      const restoredContent = restoreTerms(content, replacements);
      const translated = JSON.parse(restoredContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (Object.prototype.hasOwnProperty.call(source, 'locale')) {
        translated.locale = target.locale;
      }
      normalizeTeamTranslation(translated, target.locale);
      validateAboutTranslation(source, translated, target.translateCode);
      validateTeamTranslation(source, translated);
      return translated;
    } catch (error) {
      correction = `${error.message}. Return a complete corrected JSON object and satisfy every requirement.`;
      if (attempt === 3) {
        throw new Error(`${pageName} translation failed for locale ${target.locale} after 3 attempts: ${error.message}`);
      }
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function prepareTranslations(target) {
  const strings = [...sourceStrings];
  const missing = strings.filter((text) => !cache.has(`${target.translateCode}\n${text}`));
  const chunkSize = 30;
  const maxChunkLength = 5000;
  const chunks = [];

  for (let start = 0; start < missing.length; ) {
    const chunk = [];
    let chunkLength = 0;

    while (start < missing.length && chunk.length < chunkSize) {
      const text = missing[start];
      if (chunk.length > 0 && chunkLength + text.length > maxChunkLength) {
        break;
      }

      chunk.push(text);
      chunkLength += text.length;
      start += 1;
    }

    chunks.push(chunk);
  }

  const translateChunk = async (chunk) => {
    const translateIndividually = async () => {
      for (let start = 0; start < chunk.length; start += 5) {
        await Promise.all(
          chunk.slice(start, start + 5).map(async (source) => {
            try {
              const translated = await fetchSourceTranslation(source, target.translateCode);
              cache.set(`${target.translateCode}\n${source}`, translated);
            } catch (error) {
              throw new Error(
                `Individual translation failed for ${target.locale}, source ${JSON.stringify(source.slice(0, 80))}: ${error.message}`
              );
            }
          })
        );
      }
    };
    const encodedLines = chunk.map((text, index) => {
      const { protectedText } = protectTerms(text, !isAboutWebsiteTranslation);
      return `[[${index}]] ${protectedText}`;
    });
    const joined = encodedLines.join('\n');
    let translatedJoined;
    try {
      translatedJoined = await fetchTranslation(joined, target.translateCode);
    } catch (error) {
      console.warn(`Batch translation failed for ${target.locale}; retrying ${chunk.length} strings individually.`);
      await translateIndividually();
      return;
    }
    const lines = translatedJoined.split(/\r?\n/).filter(Boolean);
    const hasEveryMarker = chunk.every((_, index) => lines.some((line) => line.includes(`[[${index}]]`)));
    if (!hasEveryMarker) {
      console.warn(`Batch markers were incomplete for ${target.locale}; retrying ${chunk.length} strings individually.`);
      await translateIndividually();
      return;
    }

    for (let index = 0; index < chunk.length; index += 1) {
      const source = chunk[index];
      const { replacements } = protectTerms(source, !isAboutWebsiteTranslation);
      const marker = `[[${index}]]`;
      let line =
        lines.find((item) => item.includes(marker)) ||
        lines[index] ||
        (await fetchSourceTranslation(source, target.translateCode));

      line = line
        .replace(marker, '')
        .replace(/^\s*\[?\[?\d+\]?\]?\s*[.)、:-]?\s*/, '')
        .trim();

      if (!line || hasChinese(line)) {
        line = await fetchSourceTranslation(source, target.translateCode);
      }

      let restored = restoreTerms(line, replacements);
      if (/ZX(?:TRM|TERM|RAW|BR)\d*ZX/.test(restored)) {
        restored = await fetchSourceTranslation(source, target.translateCode);
      }
      cache.set(`${target.translateCode}\n${source}`, restored);
    }
  };

  for (let start = 0; start < chunks.length; start += 4) {
    await Promise.all(chunks.slice(start, start + 4).map(translateChunk));
    await sleep(120);
  }
}

function translateText(text, translateCode, translateWholeString = false) {
  if (!text || typeof text !== 'string' || !hasChinese(text)) {
    return text;
  }

  if (isAboutWebsiteTranslation || translateWholeString) {
    const override = isSoundcardWebsiteTranslation && soundcardTextOverrides[text]?.[translateCode];
    if (override) {
      return override;
    }
    return cache.get(`${translateCode}\n${text}`) || text;
  }

  return text.replace(/[\u3400-\u9fff]+/g, (source, offset, fullText) => {
    let translated =
      (isSoundcardWebsiteTranslation && soundcardTextOverrides[source]?.[translateCode]) ||
      cache.get(`${translateCode}\n${source}`) ||
      source;
    if (!['ja', 'zh-TW', 'ko'].includes(translateCode)) {
      const previous = fullText[offset - 1] || '';
      const next = fullText[offset + source.length] || '';
      if (/[A-Za-z0-9_*)\]#+'"/.]/.test(previous) && !/^\s/.test(translated)) {
        translated = ` ${translated}`;
      }
      if (/[A-Za-z0-9_(\[#+'"/.]/.test(next) && !/\s$/.test(translated)) {
        translated = `${translated} `;
      }
    }
    return translated;
  });
}

function translateJson(value, target, fieldName = null) {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => translateJson(item, target, fieldName));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === 'locale') {
        result[key] = target.locale;
      } else if (manualTextOverrides[key]?.[target.locale]) {
        result[key] = manualTextOverrides[key][target.locale];
      } else {
        result[key] = translateJson(item, target, key);
      }
    }
    return result;
  }

  if (typeof value === 'string') {
    const translateWholeString = shouldTranslateSoundcardWholeString(value, fieldName);
    return translateText(value, target.translateCode, translateWholeString);
  }

  return value;
}

function translateNavigationBrandText(text, target) {
  if (text !== navigationBrandOverride.source) {
    return null;
  }

  return navigationBrandOverride.targetByLocale[target.locale] || navigationBrandOverride.defaultTarget;
}

function translateStreamerFollowers(text) {
  return streamerFollowersOverride[text] || null;
}

function translateRow(table, source, target, columns) {
  const output = {};

  for (const column of columns) {
    if (
      ['id', 'document_id', 'created_at', 'updated_at', 'published_at', 'created_by_id', 'updated_by_id', 'locale'].includes(
        column.name
      )
    ) {
      continue;
    }

    const value = source[column.name];
    if (value === null || value === undefined) {
      output[column.name] = value;
      continue;
    }

    if (column.type.toLowerCase() === 'json') {
      const parsed = JSON.parse(value);
      output[column.name] = JSON.stringify(translateJson(parsed, target));
    } else if (table.name === 'streamers' && column.name === 'followers' && typeof value === 'string') {
      output[column.name] = translateStreamerFollowers(value) || translateText(value, target.translateCode);
    } else if (typeof value === 'string') {
      output[column.name] =
        table.name === 'navigations'
          ? translateNavigationBrandText(value, target) || translateText(value, target.translateCode)
          : translateText(value, target.translateCode);
    } else {
      output[column.name] = value;
    }
  }

  return output;
}

function insertRow(table, documentId, source, translated, locale, publishedAt) {
  const now = Date.now();
  const columns = [
    'document_id',
    ...Object.keys(translated),
    'created_at',
    'updated_at',
    'published_at',
    'created_by_id',
    'updated_by_id',
    'locale',
  ];
  const params = {
    document_id: documentId,
    ...translated,
    created_at: now,
    updated_at: now,
    published_at: publishedAt,
    created_by_id: source.created_by_id,
    updated_by_id: source.updated_by_id,
    locale,
  };

  const placeholders = columns.map((column) => `@${column}`).join(', ');
  const sql = `insert into ${table} (${columns.join(', ')}) values (${placeholders})`;
  return db.prepare(sql).run(params).lastInsertRowid;
}

function updateRow(table, id, translated, source, locale, publishedAt) {
  const params = {
    id,
    ...translated,
    updated_at: Date.now(),
    published_at: publishedAt,
    updated_by_id: source.updated_by_id,
    locale,
  };
  const sets = [
    ...Object.keys(translated).map((column) => `${column} = @${column}`),
    'updated_at = @updated_at',
    'published_at = @published_at',
    'updated_by_id = @updated_by_id',
    'locale = @locale',
  ];
  db.prepare(`update ${table} set ${sets.join(', ')} where id = @id`).run(params);
}

function syncMediaLinks(sourceId, targetId, relatedType) {
  const links = db
    .prepare('select file_id, field, "order" as order_value from files_related_mph where related_id = ? and related_type = ?')
    .all(sourceId, relatedType);
  const existing = db
    .prepare('select count(*) as count from files_related_mph where related_id = ? and related_type = ?')
    .get(targetId, relatedType).count;

  if (existing > 0 || links.length === 0) {
    return;
  }

  const insert = db.prepare(
    'insert into files_related_mph (file_id, related_id, related_type, field, "order") values (@file_id, @related_id, @related_type, @field, @order_value)'
  );

  links.forEach((link) => {
    insert.run({
      file_id: link.file_id,
      related_id: targetId,
      related_type: relatedType,
      field: link.field,
      order_value: link.order_value,
    });
  });
}

async function main() {
  const sourceHash = getSourceHash();
  const storedSourceHash = getStoredSourceHash();

  if (!forceSync && storedSourceHash === sourceHash) {
    console.log('Chinese source content unchanged. Skipping i18n sync.');
    return;
  }

  if (forceSync) {
    console.log('Force sync enabled. Regenerating localized content.');
  } else {
    console.log('Chinese source content changed. Regenerating localized content.');
  }

  const translatedByTable = [];
  const tableData = [];

  for (const table of tables) {
    const columns = db.prepare(`pragma table_info(${table.name})`).all();
    const sourcePublishedRows = db
      .prepare(`select * from ${table.name} where locale = 'zh-CN' and published_at is not null order by id`)
      .all();

    sourcePublishedRows.forEach((row) => collectRowStrings(row, columns));
    tableData.push({ table, columns, sourcePublishedRows });
  }

  console.log(`Collected ${sourceStrings.size} unique source strings.`);
  const aboutTranslations = new Map();
  const failedAboutTargets = new Set();
  for (let start = 0; start < targets.length; start += 3) {
    const targetBatch = targets.slice(start, start + 3);
    targetBatch.forEach((target) => console.log(`Translating ${target.locale}...`));
    if (isStructuredWebsiteTranslation) {
      await Promise.all(
        targetBatch.map(async (target) => {
          try {
            for (const item of tableData) {
              for (const sourcePublished of item.sourcePublishedRows) {
              const translated = await fetchAboutJsonTranslation(
                JSON.parse(sourcePublished[structuredWebsiteColumn]),
                target
              );
              applyAboutTextOverrides(translated, target.locale);
              aboutTranslations.set(`${target.locale}\n${sourcePublished.document_id}`, translated);
              }
            }
          } catch (error) {
            const existing = db
              .prepare(
                `select ${structuredWebsiteColumn} content from ${tables[0].name} where locale = ? and published_at is not null order by id limit 1`
              )
              .get(target.locale);
            if (existing) {
              const source = JSON.parse(tableData[0].sourcePublishedRows[0][structuredWebsiteColumn]);
              const retained = normalizeTeamTranslation(
                applyAboutTextOverrides(JSON.parse(existing.content), target.locale),
                target.locale
              );
              try {
                validateAboutTranslation(source, retained, target.translateCode);
                validateTeamTranslation(source, retained);
                aboutTranslations.set(`${target.locale}\n${tableData[0].sourcePublishedRows[0].document_id}`, retained);
                console.warn(`${error.message}. Retaining the validated ${target.locale} translation.`);
                return;
              } catch {
                // Fall through and skip the locale when neither result is safe to write.
              }
            }
            failedAboutTargets.add(target.locale);
            console.warn(`${error.message}. Keeping the existing ${target.locale} content unchanged.`);
          }
        })
      );
    } else {
      await Promise.all(targetBatch.map(prepareTranslations));
    }
  }

  for (const item of tableData) {
    const { table, columns, sourcePublishedRows } = item;

    const targetRows = {};
    for (const target of targets) {
      targetRows[target.locale] = db
        .prepare(`select * from ${table.name} where locale = ? order by published_at is null desc, id`)
        .all(target.locale);
    }

    for (const target of targets) {
      if (isStructuredWebsiteTranslation && failedAboutTargets.has(target.locale)) {
        continue;
      }
      const publishedTargets = targetRows[target.locale].filter((row) => row.published_at !== null);
      const draftTargets = targetRows[target.locale].filter((row) => row.published_at === null);

      for (let index = 0; index < sourcePublishedRows.length; index += 1) {
        const sourcePublished = sourcePublishedRows[index];
        const sourceDraft =
          db
            .prepare(`select * from ${table.name} where document_id = ? and locale = 'zh-CN' and published_at is null order by id limit 1`)
            .get(sourcePublished.document_id) || sourcePublished;
        const translated = translateRow(table, sourcePublished, target, columns);
        if (isStructuredWebsiteTranslation) {
          translated[structuredWebsiteColumn] = JSON.stringify(
            aboutTranslations.get(`${target.locale}\n${sourcePublished.document_id}`)
          );
        }
        translatedByTable.push({
          table,
          target,
          sourcePublished,
          sourceDraft,
          translated,
          existingPublished: publishedTargets[index],
          existingDraft: draftTargets[index],
        });
      }
    }

    console.log(`Prepared ${table.name}`);
  }

  const writeChanges = db.transaction((items) => {
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const { table, target, sourcePublished, sourceDraft, translated, existingPublished, existingDraft } = item;
      const documentId = existingPublished?.document_id || existingDraft?.document_id || makeDocumentId();

      let draftId;
      let publishedId;
      if (existingDraft) {
        updateRow(table.name, existingDraft.id, translated, sourceDraft, target.locale, null);
        draftId = existingDraft.id;
        updated += 1;
      } else {
        draftId = insertRow(table.name, documentId, sourceDraft, translated, target.locale, null);
        created += 1;
      }

      if (existingPublished) {
        updateRow(table.name, existingPublished.id, translated, sourcePublished, target.locale, sourcePublished.published_at);
        publishedId = existingPublished.id;
        updated += 1;
      } else {
        publishedId = insertRow(
          table.name,
          documentId,
          sourcePublished,
          translated,
          target.locale,
          sourcePublished.published_at
        );
        created += 1;
      }

      syncMediaLinks(sourceDraft.id, draftId, table.type);
      syncMediaLinks(sourcePublished.id, publishedId, table.type);
    }

    return { created, updated };
  });

  const result = writeChanges(translatedByTable);
  cleanupGeneratedDatabaseText();
  setStoredSourceHash(sourceHash);
  console.log(`Created ${result.created} rows, updated ${result.updated} rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
