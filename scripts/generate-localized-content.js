const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database('.tmp/data.db');
const forceSync = process.argv.includes('--force');
const sourceHashStoreKey = 'custom_i18n_zh_cn_source_hash';

const tables = [
  { name: 'homes', type: 'api::home.home' },
  { name: 'navigations', type: 'api::navigation.navigation' },
  { name: 'features', type: 'api::feature.feature' },
  { name: 'pricings', type: 'api::pricing.pricing' },
  { name: 'faqs', type: 'api::faq.faq' },
  { name: 'tutorials', type: 'api::tutorial.tutorial' },
  { name: 'cards', type: 'api::card.card' },
  { name: 'streamers', type: 'api::streamer.streamer' },
  { name: 'communitys', type: 'api::community.community' },
  { name: 'footers', type: 'api::footer.footer' },
  { name: 'forms', type: 'api::form.form' },
  { name: 'logins', type: 'api::login.login' },
  { name: 'virtuals', type: 'api::virtual.virtual' },
];

const targets = [
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

const protectedTerms = [
  'VicastCam',
  'App Store',
  'Google Play',
  'YouTube',
  'Twitch',
  'TikTok',
  'Facebook Live',
  'Instagram',
  'Android',
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

const cache = new Map();
const sourceStrings = new Set();

const hasChinese = (value) => /[\u3400-\u9fff]/.test(value);
const makeDocumentId = () => crypto.randomBytes(18).toString('base64url').slice(0, 24).toLowerCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function protectTerms(text) {
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

  return { protectedText, replacements };
}

function restoreTerms(text, replacements) {
  return replacements.reduce((result, [token, term]) => result.split(token).join(term), text);
}

function collectString(text) {
  if (text && typeof text === 'string' && hasChinese(text)) {
    sourceStrings.add(text);
  }
}

function collectJsonStrings(value) {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(collectJsonStrings);
    return;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (key !== 'locale') {
        collectJsonStrings(item);
      }
    });
    return;
  }

  collectString(value);
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

  const { protectedText, replacements } = protectTerms(text);
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=' +
    encodeURIComponent(translateCode) +
    '&dt=t&q=' +
    encodeURIComponent(protectedText);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const translated = restoreTerms(
        body[0].map((part) => part[0]).join(''),
        replacements
      );
      cache.set(cacheKey, translated);
      return translated;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`Translation failed for "${text}" -> ${translateCode}: ${error.message}`);
        cache.set(cacheKey, text);
        return text;
      }
      await sleep(300 * attempt);
    }
  }
}

async function prepareTranslations(target) {
  const strings = [...sourceStrings];
  const missing = strings.filter((text) => !cache.has(`${target.translateCode}\n${text}`));
  const chunkSize = 35;

  for (let start = 0; start < missing.length; start += chunkSize) {
    const chunk = missing.slice(start, start + chunkSize);
    const encodedLines = chunk.map((text, index) => {
      const { protectedText } = protectTerms(text);
      return `[[${index}]] ${protectedText}`;
    });
    const joined = encodedLines.join('\n');
    const translatedJoined = await fetchTranslation(joined, target.translateCode);
    const lines = translatedJoined.split(/\r?\n/).filter(Boolean);

    for (let index = 0; index < chunk.length; index += 1) {
      const source = chunk[index];
      const { replacements } = protectTerms(source);
      const marker = `[[${index}]]`;
      let line =
        lines.find((item) => item.includes(marker)) ||
        lines[index] ||
        (await fetchTranslation(source, target.translateCode));

      line = line
        .replace(marker, '')
        .replace(/^\s*\[?\[?\d+\]?\]?\s*[.)、:-]?\s*/, '')
        .trim();

      if (!line || hasChinese(line)) {
        line = await fetchTranslation(source, target.translateCode);
      }

      cache.set(`${target.translateCode}\n${source}`, restoreTerms(line, replacements));
    }

    await sleep(120);
  }
}

function translateText(text, translateCode) {
  if (!text || typeof text !== 'string' || !hasChinese(text)) {
    return text;
  }

  return cache.get(`${translateCode}\n${text}`) || text;
}

function translateJson(value, target) {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => translateJson(item, target));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === 'locale') {
        result[key] = target.locale;
      } else {
        result[key] = translateJson(item, target);
      }
    }
    return result;
  }

  if (typeof value === 'string') {
    return translateText(value, target.translateCode);
  }

  return value;
}

function translateRow(source, target, columns) {
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
    } else if (typeof value === 'string') {
      output[column.name] = translateText(value, target.translateCode);
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
  for (const target of targets) {
    console.log(`Translating ${target.locale}...`);
    await prepareTranslations(target);
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
      const publishedTargets = targetRows[target.locale].filter((row) => row.published_at !== null);
      const draftTargets = targetRows[target.locale].filter((row) => row.published_at === null);

      for (let index = 0; index < sourcePublishedRows.length; index += 1) {
        const sourcePublished = sourcePublishedRows[index];
        const sourceDraft =
          db
            .prepare(`select * from ${table.name} where document_id = ? and locale = 'zh-CN' and published_at is null order by id limit 1`)
            .get(sourcePublished.document_id) || sourcePublished;
        const translated = translateRow(sourcePublished, target, columns);
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
