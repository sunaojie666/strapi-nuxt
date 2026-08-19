import crypto from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const databasePath = path.join(projectRoot, '.tmp', 'data.db');
const localeConfigPath = path.join(scriptDirectory, 'config', 'locales.json');
const tableName = 'videos';
const sourceLocale = 'zh-CN';
const traditionalLocale = 'zh-TW';

const makeDocumentId = () => crypto.randomBytes(18).toString('base64url').slice(0, 24).toLowerCase();
const selectRows = (db, locale) => db
  .prepare(`select * from ${tableName} where locale = ? order by published_at is null desc, updated_at desc, id desc`)
  .all(locale);
const selectPreferredRow = (db, locale) => selectRows(db, locale)[0];
const extractLessons = (data) => (data.groups || []).flatMap((group) => group.lessons || []);

const locales = JSON.parse(await readFile(localeConfigPath, 'utf8')).targetLocales.map((item) => item.code);
const db = new Database(databasePath);
db.pragma('busy_timeout = 60000');
const sourceRow = selectPreferredRow(db, sourceLocale);
const englishRow = selectPreferredRow(db, 'en');
if (!sourceRow || !englishRow) throw new Error('Chinese and English video source rows are required.');

const chineseData = JSON.parse(sourceRow.data);
const englishData = JSON.parse(englishRow.data);
const chineseLessons = extractLessons(chineseData);
const englishLessons = extractLessons(englishData);
const chineseLinks = new Map(chineseLessons.map((lesson) => [lesson.id, lesson.video]));
const englishLinks = new Map(englishLessons.map((lesson) => [lesson.id, lesson.video]));
const chineseTimes = new Map(chineseLessons
  .filter((lesson) => ['beginner-10', 'beginner-11'].includes(lesson.id))
  .map((lesson) => [lesson.id, lesson.time]));
if (chineseLinks.size !== chineseLessons.length || englishLinks.size !== englishLessons.length) {
  throw new Error('Video lesson IDs must be unique in Chinese and English sources.');
}
if (JSON.stringify([...chineseLinks.keys()]) !== JSON.stringify([...englishLinks.keys()])) {
  throw new Error('Chinese and English lesson IDs/order do not match.');
}

const runId = `video-link-sync-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const backupDirectory = path.join(projectRoot, '.tmp', 'translation-backups');
await mkdir(backupDirectory, { recursive: true });
const backupPath = path.join(backupDirectory, `${runId}.data.db`);
await copyFile(databasePath, backupPath);

const timestamp = Date.now();
const sync = db.transaction(() => {
  const result = {};
  for (const locale of locales) {
    const rows = selectRows(db, locale);
    if (rows.length !== 2) throw new Error(`${locale} must have exactly one draft and one published row.`);
    const desiredLinks = locale === traditionalLocale ? chineseLinks : englishLinks;
    let updated = 0;
    for (const row of rows) {
      const data = JSON.parse(row.data);
      const lessons = extractLessons(data);
      if (lessons.length !== desiredLinks.size) {
        throw new Error(`${locale} has ${lessons.length} lessons; expected ${desiredLinks.size}.`);
      }
      for (const lesson of lessons) {
        if (!desiredLinks.has(lesson.id)) throw new Error(`${locale} contains unknown lesson ${lesson.id}.`);
        lesson.video = desiredLinks.get(lesson.id);
        if (chineseTimes.has(lesson.id)) lesson.time = chineseTimes.get(lesson.id);
      }
      db.prepare(`update ${tableName} set data = ?, updated_at = ? where id = ?`)
        .run(JSON.stringify(data), timestamp, row.id);
      updated += 1;
    }
    result[locale] = { updated, linkSource: locale === traditionalLocale ? sourceLocale : 'en' };
  }
  return result;
})();

const verification = {};
for (const locale of locales) {
  const desiredLinks = locale === traditionalLocale ? chineseLinks : englishLinks;
  const rows = selectRows(db, locale);
  verification[locale] = rows.every((row) => extractLessons(JSON.parse(row.data))
    .every((lesson) => lesson.video === desiredLinks.get(lesson.id)
      && (!chineseTimes.has(lesson.id) || lesson.time === chineseTimes.get(lesson.id))));
}
db.close();

const reportPath = path.join(scriptDirectory, 'reports', `${runId}.status.json`);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({
  runId,
  table: tableName,
  sourceLocale,
  traditionalLocale,
  lessonCount: chineseLessons.length,
  synchronizedTimes: Object.fromEntries(chineseTimes),
  result: sync,
  verification,
  backupPath,
}, null, 2)}\n`, 'utf8');
console.log(`Video link policy sync ${runId} complete: ${locales.length} locales checked.`);
console.log(`Report: ${reportPath}`);
console.log(`Backup: ${backupPath}`);
