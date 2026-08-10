import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const getArgument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const hashFile = async (filePath) => crypto.createHash('sha256').update(await readFile(filePath)).digest('hex');

async function main() {
  const source = getArgument('source');
  const translation = getArgument('translation');
  const locale = getArgument('locale');
  const contentType = getArgument('content-type');
  const status = getArgument('status');
  const reviewer = getArgument('reviewer') || 'unassigned';
  const model = getArgument('model') || 'not-recorded';
  const promptVersion = getArgument('prompt-version') || 'not-recorded';
  const runId = getArgument('run-id') || crypto.randomUUID();
  const score = Number(getArgument('score'));
  const id = getArgument('id') || crypto.randomUUID();
  if (!source || !translation || !locale || !contentType || !status || Number.isNaN(score)) throw new Error('Usage: node scripts/translation/review-manifest.mjs --source=source.json --translation=en.json --locale=en --content-type=marketing --status=approved --score=95 [--reviewer=name] [--id=id]');

  const workflow = await readJson(path.join(scriptDirectory, 'config', 'workflow.json'));
  if (!workflow.statuses.includes(status)) throw new Error(`Unsupported status: ${status}`);
  if (locale === 'en' && status === 'approved' && score < workflow.englishMaster.minimumMachineScore) throw new Error(`English approval requires a score of at least ${workflow.englishMaster.minimumMachineScore}.`);
  if (locale === 'en' && status === 'approved' && reviewer === 'unassigned') throw new Error('An approved English master requires a named reviewer.');

  const manifest = {
    id,
    locale,
    contentType,
    status,
    score,
    reviewer,
    model,
    promptVersion,
    runId,
    sourcePath: path.resolve(source),
    translationPath: path.resolve(translation),
    sourceHash: await hashFile(path.resolve(source)),
    translationHash: await hashFile(path.resolve(translation)),
    workflowVersion: workflow.version,
    glossaryVersion: (await readJson(path.join(scriptDirectory, 'glossary', 'canonical-terms.json'))).version,
    createdAt: new Date().toISOString(),
  };
  const destination = path.join(scriptDirectory, 'work', `${id}.${locale}.manifest.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(destination);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
