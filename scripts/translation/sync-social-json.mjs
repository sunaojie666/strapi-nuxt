import crypto from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const databasePath = path.join(projectRoot, '.tmp', 'data.db');
const localeConfigPath = path.join(scriptDirectory, 'config', 'locales.json');
const tableName = 'socials';
const sourceLocale = 'zh-CN';

const makeDocumentId = () => crypto.randomBytes(18).toString('base64url').slice(0, 24).toLowerCase();
const now = () => Date.now();

const localeConfig = JSON.parse(await (await import('node:fs/promises')).readFile(localeConfigPath, 'utf8'));
const targetLocales = localeConfig.targetLocales.map((item) => item.code);
const db = new Database(databasePath);
db.pragma('busy_timeout = 60000');

const sourceRows = db
  .prepare(`select * from ${tableName} where locale = ? order by published_at is null desc, updated_at desc, id desc`)
  .all(sourceLocale);
if (!sourceRows.length) throw new Error(`No ${sourceLocale} source rows found in ${tableName}`);

const sourceRow = sourceRows[0];
const sourceData = JSON.parse(sourceRow.data);
const serializedData = JSON.stringify(sourceData);
const backupDirectory = path.join(projectRoot, '.tmp', 'translation-backups');
const runId = `social-sync-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(backupDirectory, { recursive: true });
const backupPath = path.join(backupDirectory, `${runId}.data.db`);
await copyFile(databasePath, backupPath);

const sync = db.transaction(() => {
  const result = {};
  for (const locale of targetLocales) {
    const rows = db.prepare(`select * from ${tableName} where locale = ? order by published_at is null desc, id`).all(locale);
    const draft = rows.find((row) => row.published_at === null);
    const published = rows.find((row) => row.published_at !== null);
    const documentId = published?.document_id || draft?.document_id || makeDocumentId();
    const timestamp = now();
    let updated = 0;
    let created = 0;

    for (const row of [draft, published]) {
      if (!row) continue;
      db.prepare(`update ${tableName} set data = ?, updated_at = ?, published_at = ? where id = ?`)
        .run(serializedData, timestamp, row.published_at === null ? null : timestamp, row.id);
      updated += 1;
    }

    if (!draft) {
      db.prepare(`insert into ${tableName} (document_id, data, created_at, updated_at, published_at, created_by_id, updated_by_id, locale) values (?, ?, ?, ?, null, ?, ?, ?)`)
        .run(documentId, serializedData, timestamp, timestamp, sourceRow.created_by_id, sourceRow.updated_by_id, locale);
      created += 1;
    }
    if (!published) {
      db.prepare(`insert into ${tableName} (document_id, data, created_at, updated_at, published_at, created_by_id, updated_by_id, locale) values (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(documentId, serializedData, timestamp, timestamp, timestamp, sourceRow.created_by_id, sourceRow.updated_by_id, locale);
      created += 1;
    }
    result[locale] = { created, updated, status: 'published' };
  }
  return result;
})();

const verification = {};
for (const locale of targetLocales) {
  const rows = db.prepare(`select data, published_at from ${tableName} where locale = ?`).all(locale);
  verification[locale] = {
    rows: rows.length,
    drafts: rows.filter((row) => row.published_at === null).length,
    published: rows.filter((row) => row.published_at !== null).length,
    matchesChineseJson: rows.every((row) => JSON.stringify(JSON.parse(row.data)) === serializedData),
  };
}
db.close();

const reportPath = path.join(scriptDirectory, 'reports', `${runId}.status.json`);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({ runId, sourceLocale, table: tableName, sourceRowId: sourceRow.id, sourceKeys: Object.keys(sourceData), targetLocales, result: sync, verification, backupPath }, null, 2)}\n`, 'utf8');
console.log(`Social JSON sync ${runId} complete: ${targetLocales.length} locales synced.`);
console.log(`Report: ${reportPath}`);
console.log(`Backup: ${backupPath}`);
