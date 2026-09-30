import fs from 'node:fs';
import {GROUP_CATALOG, extractTelegramUsername} from '../lib/group-catalog';

type Item = {
  username: string;
  category: string;
  title: string;
  extra: string;
  url: string;
  public: boolean;
};

const ok = JSON.parse(fs.readFileSync('/tmp/all_channels_ok.json', 'utf8')) as Item[];

const existing = new Set(
  GROUP_CATALOG.filter((g) => g.url)
    .map((g) => (extractTelegramUsername(g.url) || '').toLowerCase())
    .filter(Boolean),
);

const nicheByCat: Record<string, string[]> = {
  blogs: ['blogs', 'content', 'networking'],
  business: ['blogs', 'business', 'leadgen', 'networking'],
  marketing: ['blogs', 'marketing', 'leadgen', 'smm'],
};

function slug(u: string) {
  return u
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const lines: string[] = [];
lines.push('  // ——— TGStat dump: Блоги / Бизнес / Маркетинг (все проверенные t.me) ———');
let added = 0;
for (const item of ok) {
  const user = item.username;
  const key = user.toLowerCase();
  if (existing.has(key)) continue;
  const niches = nicheByCat[item.category] || ['blogs', 'business'];
  const id = `tgstat-${item.category}-${slug(user)}`;
  const name = (item.title || user).trim() || user;
  const desc =
    item.category === 'blogs'
      ? `Канал из TGStat «Блоги» (${item.extra || 'публичный'}).`
      : item.category === 'business'
        ? `Канал из TGStat «Бизнес и стартапы» (${item.extra || 'публичный'}).`
        : `Канал из TGStat «Маркетинг» (${item.extra || 'публичный'}).`;
  const audience =
    item.category === 'marketing' ? 'Маркетинг' : item.category === 'business' ? 'Бизнес' : 'Блоги';
  lines.push(
    `  g("${id}", "${esc(name)}", "${item.url}", [${niches.map((n) => `"${n}"`).join(', ')}], "${esc(desc)}", "${audience}"),`,
  );
  existing.add(key);
  added += 1;
}
lines.push('');

fs.writeFileSync('/tmp/tgstat_catalog_block.ts', lines.join('\n'));
console.log(JSON.stringify({toAdd: added, totalOk: ok.length, skippedExisting: ok.length - added}, null, 2));
