import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const getArgument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function addIssue(issues, pathName, code, message, severity = 'error') {
  issues.push({ path: pathName, code, severity, message });
}

function compareShape(source, candidate, pathName, issues) {
  if (Array.isArray(source)) {
    if (!Array.isArray(candidate)) return addIssue(issues, pathName, 'array-type-changed', 'Expected an array.');
    if (source.length !== candidate.length) addIssue(issues, pathName, 'array-length-changed', `Expected ${source.length} items, received ${candidate.length}.`);
    source.forEach((item, index) => compareShape(item, candidate[index], `${pathName}[${index}]`, issues));
    return;
  }
  if (source && typeof source === 'object') {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return addIssue(issues, pathName, 'object-type-changed', 'Expected an object.');
    const sourceKeys = Object.keys(source).sort();
    const candidateKeys = Object.keys(candidate).sort();
    if (JSON.stringify(sourceKeys) !== JSON.stringify(candidateKeys)) addIssue(issues, pathName, 'object-keys-changed', 'Object keys must remain exactly unchanged.');
    sourceKeys.forEach((key) => compareShape(source[key], candidate[key], `${pathName}.${key}`, issues));
    return;
  }
  if (typeof source !== typeof candidate) addIssue(issues, pathName, 'value-type-changed', `Expected ${typeof source}, received ${typeof candidate}.`);
}

function collectText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(collectText).join('\n');
  return '';
}

function collectProtectedValues(value) {
  const text = collectText(value);
  return new Set([
    ...(text.match(/https?:\/\/[^\s"']+/g) || []),
    ...(text.match(/{[^{}]+}/g) || []),
    ...(text.match(/(?:\$|EUR\s?|USD\s?|CNY\s?|JPY\s?|KRW\s?|GBP\s?)\d[\d,]*(?:\.\d+)?/g) || []),
    ...(text.match(/\b\d+(?:\.\d+)?(?:%|x|X|\+)?\b/g) || []),
  ]);
}

function containsProtectedValue(candidateText, value, locale) {
  if (candidateText.includes(value)) return true;
  if (locale === 'en') return false;

  const isMoney = /^(?:\$|EUR\s?|USD\s?|CNY\s?|JPY\s?|KRW\s?|GBP\s?)\d/.test(value);
  if (isMoney) {
    const amount = value.replace(/\D/g, '');
    const normalizedCandidate = candidateText
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
      .replace(/(?<=\d)[,.\s](?=\d)/g, '');
    return amount.length > 0 && normalizedCandidate.includes(amount);
  }

  // Downstream website copy may spell out standalone numbers (for example, localized
  // equivalents of "24/7"). Structure and independent review still guard the meaning.
  return /^\d+(?:\.\d+)?(?:%|x|X|\+)?$/.test(value);
}

async function main() {
  const sourcePath = getArgument('source');
  const candidatePath = getArgument('candidate');
  const locale = getArgument('locale');
  const contentType = getArgument('content-type');
  const outputPath = getArgument('output');
  if (!sourcePath || !candidatePath || !locale || !contentType) throw new Error('Usage: node scripts/translation/validate-localization.mjs --source=source.json --candidate=translation.json --locale=en --content-type=marketing [--output=report.json]');

  const [source, candidate, glossary, workflow] = await Promise.all([
    readJson(path.resolve(sourcePath)),
    readJson(path.resolve(candidatePath)),
    readJson(path.join(scriptDirectory, 'glossary', 'canonical-terms.json')),
    readJson(path.join(scriptDirectory, 'config', 'workflow.json')),
  ]);
  const issues = [];
  compareShape(source, candidate, '$', issues);
  const candidateText = collectText(candidate);
  collectProtectedValues(source).forEach((value) => {
    if (!containsProtectedValue(candidateText, value, locale)) {
      addIssue(issues, '$', 'protected-value-missing', `Missing protected value: ${value}`);
    }
  });
  glossary.terms
    .filter((term) => term.translate === false && collectText(source).includes(term.source))
    .forEach((term) => {
      if (!candidateText.includes(term.en)) addIssue(issues, '$', 'protected-term-missing', `Missing required term: ${term.en}`);
    });
  if (locale === 'en') {
    glossary.terms
      .filter((term) => term.translate && collectText(source).includes(term.source))
      .forEach((term) => {
        if (!candidateText.toLowerCase().includes(term.en.toLowerCase())) {
          addIssue(issues, '$', 'glossary-term-missing', `Expected approved English term: ${term.en}`, 'warning');
        }
      });
  }

  const hasErrors = issues.some((item) => item.severity === 'error');
  const highRisk = workflow.highRiskPaths.some((item) => sourcePath.toLowerCase().includes(item));
  const requiresHumanReview = workflow.contentTypes[contentType]?.requiresHumanReview || highRisk;
  const report = {
    version: workflow.version,
    locale,
    contentType,
    sourceHash: hash(source),
    translationHash: hash(candidate),
    status: hasErrors ? 'rejected' : requiresHumanReview ? 'needs-human-review' : 'machine-reviewed',
    requiresHumanReview,
    issues,
    checkedAt: new Date().toISOString(),
  };
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(path.resolve(outputPath), content, 'utf8'); else process.stdout.write(content);
  if (hasErrors) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
