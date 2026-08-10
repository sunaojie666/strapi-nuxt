import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const getArgument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

function stripHtml(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function collectMatches(html, pattern, limit = 40) {
  return [...html.matchAll(pattern)].map((match) => stripHtml(match[1])).filter(Boolean).slice(0, limit);
}

async function main() {
  const locale = getArgument('locale');
  const urls = getArgument('urls')?.split(',').map((url) => url.trim()).filter(Boolean) || [];
  if (!locale || urls.length === 0) throw new Error('Usage: node scripts/translation/collect-locale-references.mjs --locale=ja --urls=https://example.com,https://example.com/help');
  urls.forEach((value) => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error(`Only public HTTPS URLs are allowed: ${value}`);
    }
  });

  const pages = [];
  for (const url of urls) {
    const response = await fetch(url, { headers: { 'user-agent': 'VicastCam-localization-research/1.0' } });
    if (!response.ok) {
      pages.push({ url, status: response.status, error: `HTTP ${response.status}` });
      continue;
    }
    const html = await response.text();
    pages.push({
      url,
      status: response.status,
      title: stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
      descriptions: collectMatches(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/gi, 4),
      headings: collectMatches(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 30),
      buttons: collectMatches(html, /<(?:button|a)[^>]*(?:class|role)=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 30),
      collectedAt: new Date().toISOString(),
    });
  }

  const destination = path.join(scriptDirectory, 'references', 'collected', `${locale}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify({ locale, sourcePolicy: 'public reference text only; never copy facts or wording', observationsRequired: ['headline structure', 'sentence length', 'CTA wording', 'navigation labels', 'support content tone', 'mobile readability'], pages }, null, 2)}\n`, 'utf8');
  console.log(destination);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
