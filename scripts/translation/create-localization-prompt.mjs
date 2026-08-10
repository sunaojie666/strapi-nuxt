import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProtectedTerms = [
  'VicastCam',
  'SDK',
  'API',
  'AI',
  'iOS',
  'Android',
  'Windows',
  'macOS',
  'App Store',
  'Google Play',
  'YouTube',
  'TikTok',
  'Twitch',
  'USB',
  'PC',
  '2D',
  '3D',
];

function getArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function showUsage(error) {
  if (error) {
    console.error(`Error: ${error}`);
  }

  console.error(
    'Usage: node scripts/translation/create-localization-prompt.mjs --locale=en --source-locale=zh-CN --content-type=marketing --input=input/module.json [--output=prompt.txt]'
  );
  process.exitCode = 1;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function hashFile(filePath) {
  return crypto.createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function collectStrings(value, pathName = '$', output = []) {
  if (typeof value === 'string') {
    output.push({ path: pathName, value });
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${pathName}[${index}]`, output));
    return output;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectStrings(item, `${pathName}.${key}`, output));
  }

  return output;
}

function findProtectedValues(source) {
  const strings = collectStrings(source);
  const found = new Set(defaultProtectedTerms.filter((term) => strings.some(({ value }) => value.includes(term))));

  strings.forEach(({ value }) => {
    value.match(/https?:\/\/[^\s"']+/g)?.forEach((url) => found.add(url));
    value.match(/{[^{}]+}/g)?.forEach((placeholder) => found.add(placeholder));
    value.match(/(?:USD|EUR|CNY|JPY|KRW|GBP)s?[d,.]+/g)?.forEach((amount) => found.add(amount));
  });

  return [...found].sort((left, right) => left.localeCompare(right));
}

function buildPrompt({ locale, sourceLocale, contentType, source, localeProfile, localeExperience, collectedReferences, contentRule, englishMasterRule, glossary }) {
  const protectedValues = findProtectedValues(source);
  const legalNotice =
    contentType === 'legal'
      ? 'Set `needsHumanLegalReview` to true. This content must not be published automatically.'
      : 'Set `needsHumanLegalReview` to false.';

  return [
    `You are a senior native ${locale.name} localization editor for ${locale.market}.`,
    `Localize the supplied complete VicastCam ${contentRule.description} from ${sourceLocale.language} (${sourceLocale.code}) into ${locale.language} (${locale.code}).`,
    '',
    sourceLocale.code === 'zh-CN'
      ? 'This is the first translation stage. The Simplified Chinese source is the factual source of truth. Produce an English master suitable for reuse as the source for every later locale.'
      : 'This is the second translation stage. The approved English master is the only translation source. Do not infer wording, claims, or intent from Chinese or any other locale.',
    'Preserve all factual meaning, product limitations, numbers, dates, prices, currencies, URLs, email addresses, field keys, JSON value types, array order, and template variables exactly.',
    'Do not add, remove, weaken, broaden, narrow, or substitute a feature, use case, target audience, guarantee, comparison, condition, limitation, or commercial claim. When the source is ambiguous, preserve that ambiguity rather than inventing a more marketable claim.',
    'You may rewrite sentence order, syntax, headline length, idioms, and calls to action when needed so the result reads as original copy written by a native editor for the target market.',
    'Comparable English-language product websites may inform sentence rhythm, page hierarchy, CTA conventions, and terminology patterns only. They are never a source of product facts or claims, and their wording must never be copied.',
    'Return one JSON object only, with exactly the same keys, nesting, and array lengths as the input. Do not add markdown, explanations, comments, or extra fields inside the localized content.',
    '',
    'Target-market style:',
    `- Voice: ${localeProfile.voice}`,
    `- Headlines: ${localeProfile.headline}`,
    `- Calls to action: ${localeProfile.cta}`,
    `- Avoid: ${localeProfile.avoid.join('; ')}.`,
    `- Grammar and sentence structure: ${localeExperience.grammar}`,
    `- Recommended information structure: ${localeExperience.structure}`,
    `- Formality: ${localeExperience.formality}`,
    `- User experience and UI conventions: ${localeExperience.ux}`,
    `- Local review focus: ${localeExperience.review}`,
    ...(collectedReferences
      ? [
          '',
          'Collected public reference patterns for this locale (style only; never copy wording or facts):',
          `- Reference pages: ${collectedReferences.pages?.length || 0}`,
          `- Sample headings: ${(collectedReferences.pages || []).flatMap((page) => page.headings || []).slice(0, 12).join(' | ') || 'none collected'}`,
          `- Sample CTAs: ${(collectedReferences.pages || []).flatMap((page) => page.buttons || []).slice(0, 12).join(' | ') || 'none collected'}`,
          'Use these samples only to understand local rhythm, terminology patterns, sentence length, and user-facing actions. Do not copy them.',
        ]
      : ['', 'No public reference sample has been collected for this locale yet. Follow the locale profile and mark the output for native-speaker review.']),
    '',
    'Content-type requirements:',
    ...contentRule.instructions.map((instruction) => `- ${instruction}`),
    ...(locale.code === 'en'
      ? [
          '',
          'English-master requirements:',
          ...englishMasterRule.internationalEnglish.map((instruction) => `- ${instruction}`),
          ...englishMasterRule.grammarAndStyleChecks.map((instruction) => `- ${instruction}`),
          ...englishMasterRule.referenceUse.map((instruction) => `- ${instruction}`),
        ]
      : []),
    '',
    'Approved glossary terms:',
    ...glossary.terms.map((term) => `- ${term.source} => ${term.en}${term.translate === false ? ' (do not translate)' : ''}`),
    '',
    'Protected values that must remain exactly unchanged when present:',
    ...(protectedValues.length ? protectedValues.map((value) => `- ${value}`) : ['- No protected values detected.']),
    '',
    'Final self-review before answering:',
    `- Does every string sound like a ${locale.market} technology website, rather than translated Chinese?`,
    '- Are headings concise and concrete, with no abstract corporate slogans?',
    '- Are feature labels noun phrases or action labels, not past-tense sentences?',
    '- Is the complete JSON structure unchanged?',
    `- ${legalNotice}`,
    '',
    'Source JSON:',
    JSON.stringify(source, null, 2),
  ].join('\n');
}

async function main() {
  const localeCode = getArgument('locale');
  const requestedSourceLocaleCode = getArgument('source-locale');
  const contentType = getArgument('content-type');
  const inputPath = getArgument('input');
  const outputPath = getArgument('output');
  const englishManifestPath = getArgument('english-manifest');

  if (!localeCode || !contentType || !inputPath) {
    showUsage('Missing --locale, --content-type, or --input.');
    return;
  }

  const [localeConfig, localeProfiles, localeExperiences, contentTypes, englishMasterRule, glossary, workflow] = await Promise.all([
    readJson(path.join(scriptDirectory, 'config', 'locales.json')),
    readJson(path.join(scriptDirectory, 'rules', 'locale-profiles.json')),
    readJson(path.join(scriptDirectory, 'rules', 'locale-experience.json')),
    readJson(path.join(scriptDirectory, 'rules', 'content-types.json')),
    readJson(path.join(scriptDirectory, 'rules', 'en-master.json')),
    readJson(path.join(scriptDirectory, 'glossary', 'canonical-terms.json')),
    readJson(path.join(scriptDirectory, 'config', 'workflow.json')),
  ]);
  const locale = localeConfig.targetLocales.find((item) => item.code === localeCode);
  const sourceLocaleCode = localeCode === localeConfig.intermediateLocale ? localeConfig.sourceLocale : localeConfig.intermediateLocale;
  const sourceLocale =
    sourceLocaleCode === localeConfig.sourceLocale
      ? { code: localeConfig.sourceLocale, language: 'zh-CN', name: 'Simplified Chinese' }
      : localeConfig.targetLocales.find((item) => item.code === sourceLocaleCode);
  const localeProfile = localeProfiles[localeCode];
  const localeExperience = localeExperiences[localeCode];
  const contentRule = contentTypes[contentType];

  if (!locale) {
    showUsage(`Unsupported target locale: ${localeCode}`);
    return;
  }
  if (!sourceLocale) {
    showUsage(`No source locale configuration found for: ${sourceLocaleCode}`);
    return;
  }
  if (requestedSourceLocaleCode && requestedSourceLocaleCode !== sourceLocaleCode) {
    showUsage(
      `Invalid source locale for ${localeCode}: expected ${sourceLocaleCode}, received ${requestedSourceLocaleCode}. The required pipeline is zh-CN -> en -> all other locales.`
    );
    return;
  }
  if (localeCode !== localeConfig.intermediateLocale) {
    if (!englishManifestPath) {
      showUsage('Every non-English translation requires --english-manifest=path/to/approved.en.manifest.json.');
      return;
    }
    const manifest = await readJson(path.resolve(englishManifestPath));
    const currentInputHash = await hashFile(path.resolve(inputPath));
    if (manifest.locale !== localeConfig.intermediateLocale || manifest.status !== 'approved') {
      showUsage('The English manifest must be an approved en master.');
      return;
    }
    if (manifest.translationHash !== currentInputHash) {
      showUsage('The English manifest does not match the supplied English master file. Re-review the current English file before translating downstream locales.');
      return;
    }
  }
  if (!localeProfile) {
    showUsage(`No locale style profile found for: ${localeCode}`);
    return;
  }
  if (!localeExperience) {
    showUsage(`No locale experience profile found for: ${localeCode}`);
    return;
  }
  if (!contentRule) {
    showUsage(`Unsupported content type: ${contentType}`);
    return;
  }

  const source = await readJson(path.resolve(inputPath));
  let collectedReferences = null;
  try {
    collectedReferences = await readJson(path.join(scriptDirectory, 'references', 'collected', `${localeCode}.json`));
  } catch {
    // The downstream market-research gate below produces the user-facing error.
  }
  if (localeCode !== localeConfig.intermediateLocale && workflow.marketResearch.requiredForEveryDownstreamLocale) {
    const successfulPages = (collectedReferences?.pages || []).filter((page) => page.status >= 200 && page.status < 300).length;
    if (successfulPages < workflow.marketResearch.minimumSuccessfulPublicReferencePages) {
      showUsage(`Locale ${localeCode} needs at least ${workflow.marketResearch.minimumSuccessfulPublicReferencePages} successful public reference pages before translation. Run collect-locale-references.mjs first.`);
      return;
    }
  }
  const prompt = buildPrompt({ locale, sourceLocale, contentType, source, localeProfile, localeExperience, collectedReferences, contentRule, englishMasterRule, glossary });

  if (outputPath) {
    await writeFile(path.resolve(outputPath), `${prompt}\n`, 'utf8');
    console.log(`Prompt written to ${path.resolve(outputPath)}`);
    return;
  }

  process.stdout.write(`${prompt}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
