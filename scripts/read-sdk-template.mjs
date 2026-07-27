import Database from "better-sqlite3";

const db = new Database(".tmp/data.db", { readonly: true });
const result = {};

for (const table of ["sdks", "cameras"]) {
  const rows = db.prepare(`select * from ${table} where locale = ? order by id`).all("zh-CN");
  result[table] = rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      id: row.id,
      documentId: row.document_id,
      published: row.published_at !== null,
      topLevelKeys: Object.keys(data),
      data,
    };
  });
}

if (process.argv.includes("--summary")) {
  const summary = Object.fromEntries(Object.entries(result).map(([table, rows]) => [table, rows.map((row) => {
    const page = row.data?.sdkBox ?? row.data?.module ?? row.data;
    return {
      id: row.id,
      documentId: row.documentId,
      published: row.published,
      topLevelKeys: row.topLevelKeys,
      pageKeys: Object.keys(page ?? {}),
      pageTitle: page?.hero?.title ?? page?.title ?? null,
      heroKeys: Object.keys(page?.hero ?? {}),
      functionKeys: Object.keys(page?.functions ?? {}),
      quickStartKeys: Object.keys(page?.quickStart ?? {}),
      errorCodeCount: page?.errorCodes?.items?.length ?? 0,
    };
  })]));
  process.stdout.write(JSON.stringify(summary, null, 2));
} else if (process.argv.includes("--camera-shape")) {
  const source = result.cameras.find((row) => row.published)?.data ?? result.cameras[0]?.data;
  const module = source.module;
  process.stdout.write(JSON.stringify({
    moduleKey: source.moduleKey,
    moduleKeys: Object.keys(module),
    itemsType: Array.isArray(module.items) ? "array" : typeof module.items,
    itemKeys: Array.isArray(module.items) ? module.items.map((item) => Object.keys(item)) : Object.keys(module.items ?? {}),
    documentsType: Array.isArray(module.documents) ? "array" : typeof module.documents,
    documentKeys: Array.isArray(module.documents) ? module.documents.map((document) => Object.keys(document)) : Object.keys(module.documents ?? {}),
    module,
  }, null, 2));
} else {
  process.stdout.write(JSON.stringify(result, null, 2));
}
