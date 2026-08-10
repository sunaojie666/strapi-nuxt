import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const getArgument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

async function main() {
  const sourcePath = getArgument('source');
  const candidatePath = getArgument('candidate');
  const locale = getArgument('locale');
  const contentType = getArgument('content-type');
  const outputPath = getArgument('output');
  if (!sourcePath || !candidatePath || !locale || !contentType) throw new Error('Usage: node scripts/translation/create-review-prompt.mjs --source=source.json --candidate=translation.json --locale=en --content-type=marketing [--output=review-prompt.txt]');

  const [source, candidate, localeConfig, profiles, experiences, masterRule, glossary] = await Promise.all([
    readJson(path.resolve(sourcePath)),
    readJson(path.resolve(candidatePath)),
    readJson(path.join(scriptDirectory, 'config', 'locales.json')),
    readJson(path.join(scriptDirectory, 'rules', 'locale-profiles.json')),
    readJson(path.join(scriptDirectory, 'rules', 'locale-experience.json')),
    readJson(path.join(scriptDirectory, 'rules', 'en-master.json')),
    readJson(path.join(scriptDirectory, 'glossary', 'canonical-terms.json')),
  ]);
  const localeInfo = localeConfig.targetLocales.find((item) => item.code === locale);
  if (!localeInfo || !profiles[locale]) throw new Error(`Unsupported locale: ${locale}`);
  if (!experiences[locale]) throw new Error(`No locale experience profile: ${locale}`);
  let collectedReferences = null;
  try {
    collectedReferences = await readJson(path.join(scriptDirectory, 'references', 'collected', `${locale}.json`));
  } catch {
    // Missing references require stronger native-speaker review.
  }

  const prompt = [
    `You are an independent senior native ${localeInfo.name} editor reviewing a VicastCam ${contentType} localization for ${localeInfo.market}.`,
    'You did not write the candidate. Audit it rigorously against the source. Do not praise it, summarize it, or silently overlook errors.',
    'Check structure, every product fact, feature, audience, limitation, price, number, date, URL, template variable, brand name, glossary term, grammar, naturalness, CTA intent, and target-market website style.',
    'Treat the source as the factual authority. Flag any added, removed, weakened, broadened, narrowed, or substituted meaning.',
    `Locale grammar and structure: ${experiences[locale].grammar}; ${experiences[locale].structure}`,
    `Locale UX conventions: ${experiences[locale].ux}`,
    `Locale-specific review focus: ${experiences[locale].review}`,
    collectedReferences
      ? `Public reference samples were collected from ${collectedReferences.pages?.length || 0} page(s). Compare rhythm, labels, and information density only; never copy wording or facts.`
      : 'No public reference sample is available. Increase scrutiny for local grammar, CTA conventions, and user experience.',
    locale === 'en'
      ? [...masterRule.reviewQuestions, ...masterRule.grammarAndStyleChecks].map((item) => `- ${item}`).join('\n')
      : `- Apply this locale style: ${profiles[locale].voice}\n- Avoid: ${profiles[locale].avoid.join('; ')}`,
    `Approved glossary: ${glossary.terms.map((term) => `${term.source} => ${term.en}`).join(' | ')}`,
    'Return exactly one JSON object with this schema:',
    '{"score": 0, "status": "approved|revise|needs-human-review", "issues": [{"path": "$.field", "category": "grammar|literal_translation|meaning_change|glossary|structure|style|seo", "severity": "critical|major|minor", "instruction": "specific correction"}], "revisedContent": {}}',
    'Use score 90 or higher only when there are no unresolved major or critical issues. Keep revisedContent structurally identical to the candidate and include it only when a rewrite is needed.',
    'Source JSON:',
    JSON.stringify(source, null, 2),
    'Candidate JSON:',
    JSON.stringify(candidate, null, 2),
  ].join('\n\n');
  if (outputPath) await writeFile(path.resolve(outputPath), `${prompt}\n`, 'utf8'); else process.stdout.write(`${prompt}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
