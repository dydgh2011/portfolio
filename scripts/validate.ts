// Content checks for content/. Run: node scripts/validate.ts
// Errors fail the build (exit 1). Warnings are printed only.
// Uses Node's built-in type stripping, so no dependencies are needed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
const errors: string[] = [];
const warnings: string[] = [];
const error = (msg: string) => errors.push(msg);
const warn = (msg: string) => warnings.push(msg);

const LIMITS = { summary: 70, highlightText: 80, experienceHighlights: 4, projectHighlights: 3 };
const CATEGORIES = ['languages', 'spoken', 'backend', 'frontend', 'databases', 'infrastructure', 'ai'];
const SLOTS = ['weapon', 'skill'];
const ALLOWED_CONTACTS = ['email', 'github', 'linkedin', 'reddit'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readJson(rel: string): any {
  const path = join(root, rel);
  if (!existsSync(path)) {
    error(`${rel}: file not found`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    error(`${rel}: invalid JSON (${(e as Error).message})`);
    return undefined;
  }
}

function checkIds(file: string, list: any[]): Set<string> {
  const seen = new Set<string>();
  for (const item of list ?? []) {
    if (typeof item?.id !== 'string') error(`${file}: entry without an id`);
    else if (seen.has(item.id)) error(`${file}: duplicate id "${item.id}"`);
    else {
      if (!KEBAB.test(item.id)) warn(`${file}: id "${item.id}" is not kebab-case`);
      seen.add(item.id);
    }
  }
  return seen;
}

// ---------- data ----------

const profile = readJson('data/profile.json');
const elements = readJson('data/elements.json') ?? {};
const game = readJson('data/game.json') ?? {};
const skills: any[] = readJson('data/skills.json') ?? [];
const experience: any[] = readJson('data/experience.json') ?? [];
const projects: any[] = readJson('data/projects.json') ?? [];
const education: any[] = readJson('data/education.json') ?? [];

const skillIds = checkIds('data/skills.json', skills);
const expIds = checkIds('data/experience.json', experience);
const projIds = checkIds('data/projects.json', projects);
const eduIds = checkIds('data/education.json', education);
const effectTypes: string[] = game.effectTypes ?? [];

const usedIcons = new Set<string>();
const iconDir = join(root, 'icons');
const iconFiles = existsSync(iconDir) ? readdirSync(iconDir).filter((f) => !f.startsWith('.')) : [];

for (const s of skills) {
  const where = `data/skills.json "${s.id}"`;
  if (!s.name) error(`${where}: missing name`);
  if (!CATEGORIES.includes(s.category)) error(`${where}: unknown category "${s.category}"`);
  if (s.parent !== undefined && !skillIds.has(s.parent)) error(`${where}: parent "${s.parent}" is not a skill id`);
  if (s.icon) usedIcons.add(s.icon);
  if (s.game) {
    if (!SLOTS.includes(s.game.slot)) error(`${where}: game.slot "${s.game.slot}" must be one of ${SLOTS.join(', ')}`);
    if (!(s.game.element in elements)) error(`${where}: game.element "${s.game.element}" is not in elements.json`);
    if (!effectTypes.includes(s.game.effect?.type)) error(`${where}: effect.type "${s.game.effect?.type}" is not in game.json effectTypes`);
    if (!s.icon || !iconFiles.includes(s.icon)) warn(`${where}: has game but icon ${s.icon ? `"${s.icon}" is missing` : 'is not set'} (game uses the element's default icon)`);
  }
}
for (const f of iconFiles) if (!usedIcons.has(f)) warn(`icons/${f}: no skill uses this icon`);

function checkSkillRefs(file: string, list: any[]) {
  for (const entry of list) {
    for (const id of entry.skills ?? []) {
      if (!skillIds.has(id)) error(`${file} "${entry.id}": skill "${id}" does not exist`);
    }
    // cardSkills (optional): the chips shown on the card, picked from `skills`
    for (const id of entry.cardSkills ?? []) {
      if (!(entry.skills ?? []).includes(id)) error(`${file} "${entry.id}": cardSkills "${id}" is not in its skills`);
    }
    if (entry.game?.difficulty !== undefined && typeof entry.game.difficulty !== 'number') {
      error(`${file} "${entry.id}": game.difficulty must be a number`);
    }
  }
}
checkSkillRefs('data/experience.json', experience);
checkSkillRefs('data/projects.json', projects);
checkSkillRefs('data/education.json', education);

// Flags come from assets/kenney/flag-pack/<CC>.png.
const flagDir = join(root, '..', 'assets', 'kenney', 'flag-pack');
function checkFlag(where: string, country: unknown) {
  if (country === undefined) return;
  if (typeof country !== 'string' || !/^[A-Z]{2}(_[A-Z]{3})?$/.test(country)) error(`${where}: country "${country}" must be a country code like "KR"`);
  else if (!existsSync(join(flagDir, `${country}.png`))) warn(`${where}: no flag image assets/kenney/flag-pack/${country}.png (shown without a flag)`);
}
for (const e of experience) checkFlag(`data/experience.json "${e.id}"`, e.country);
for (const e of education) checkFlag(`data/education.json "${e.id}"`, e.country);

function checkHighlightCount(file: string, list: any[], max: number) {
  for (const entry of list) {
    const ids: string[] = entry.highlights ?? [];
    if (ids.length > max) error(`${file} "${entry.id}": ${ids.length} highlights, max is ${max}`);
    if (new Set(ids).size !== ids.length) error(`${file} "${entry.id}": duplicate highlight id`);
  }
}
checkHighlightCount('data/experience.json', experience, LIMITS.experienceHighlights);
checkHighlightCount('data/projects.json', projects, LIMITS.projectHighlights);

for (const [name, e] of Object.entries<any>(elements)) {
  if (!/^#[0-9a-f]{6}$/i.test(e.color ?? '')) error(`data/elements.json "${name}": color must be #rrggbb`);
}
for (const step of game.route ?? []) {
  if (!['intro', 'skills', 'education', 'experience', 'projects'].includes(step)) error(`data/game.json: unknown route step "${step}"`);
}

if (profile) {
  for (const c of profile.contacts ?? []) {
    if (!ALLOWED_CONTACTS.includes(c.type)) error(`data/profile.json: contact type "${c.type}" is not allowed on the public site`);
  }
  if (!profile.languages?.includes(profile.defaultLanguage)) error('data/profile.json: defaultLanguage is not in languages');
  for (const [lang, country] of Object.entries(profile.languageFlags ?? {})) checkFlag(`data/profile.json languageFlags.${lang}`, country);
  for (const [kind, path] of Object.entries<string>(profile.resumePdf ?? {})) {
    if (!existsSync(join(root, path))) warn(`data/profile.json: resume "${kind}" file content/${path} is missing (download button is hidden)`);
  }
}

// ---------- i18n ----------

const langs: string[] = profile?.languages ?? ['en'];
const i18n = (lang: string, name: string) => readJson(`i18n/${lang}/${name}.json`) ?? {};
const textLen = (s: string) => [...s].length;

// English is required for every entry and highlight.
const en = {
  experience: i18n('en', 'experience'),
  projects: i18n('en', 'projects'),
  education: i18n('en', 'education'),
  profile: i18n('en', 'profile'),
  ui: i18n('en', 'ui'),
};

function requireText(file: string, obj: any, keys: string[], id: string) {
  for (const k of keys) if (!obj?.[k]) error(`${file}: "${id}" has no English ${k}`);
}

for (const e of experience) {
  const t = en.experience[e.id];
  requireText('i18n/en/experience.json', t, ['title', 'summary'], e.id);
  for (const h of e.highlights ?? []) requireText('i18n/en/experience.json', t?.highlights?.[h], ['metric', 'text'], `${e.id}.${h}`);
}
for (const p of projects) {
  const t = en.projects[p.id];
  requireText('i18n/en/projects.json', t, ['name', 'summary'], p.id);
  for (const h of p.highlights ?? []) requireText('i18n/en/projects.json', t?.highlights?.[h], ['metric', 'text'], `${p.id}.${h}`);
}
for (const e of education) requireText('i18n/en/education.json', en.education[e.id], ['degree'], e.id);
requireText('i18n/en/profile.json', en.profile, ['headline', 'about'], 'profile');

const idsByFile: Record<string, Set<string>> = {
  experience: expIds,
  projects: projIds,
  education: eduIds,
  skills: skillIds,
};

function missingKeys(base: any, other: any, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(base ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (other?.[k] === undefined) out.push(path);
    else if (typeof v === 'object' && v !== null) out.push(...missingKeys(v, other[k], path));
  }
  return out;
}

for (const lang of langs) {
  for (const name of ['profile', 'experience', 'projects', 'education', 'skills', 'ui']) {
    const file = `i18n/${lang}/${name}.json`;
    const t = i18n(lang, name);

    // Text for ids that do not exist in data.
    const ids = idsByFile[name];
    if (ids) for (const id of Object.keys(t)) if (!ids.has(id)) warn(`${file}: "${id}" is not an id in data/${name}.json`);

    // Style limits for every language.
    for (const [id, entry] of Object.entries<any>(name === 'experience' || name === 'projects' ? t : {})) {
      if (entry.summary && textLen(entry.summary) > LIMITS.summary) {
        warn(`${file} "${id}": summary is ${textLen(entry.summary)} chars (style limit ${LIMITS.summary})`);
      }
      for (const [hid, h] of Object.entries<any>(entry.highlights ?? {})) {
        if (h.text && textLen(h.text) > LIMITS.highlightText) {
          warn(`${file} "${id}.${hid}": text is ${textLen(h.text)} chars (style limit ${LIMITS.highlightText})`);
        }
      }
    }

    // Missing translations fall back to English. Only check keys that are shown.
    if (lang === 'en' || name === 'skills') continue;
    let base: any = en[name as keyof typeof en];
    if (name === 'experience' || name === 'projects') {
      const list = name === 'experience' ? experience : projects;
      base = Object.fromEntries(
        list.map((entry) => {
          const full = base[entry.id] ?? {};
          const highlights = Object.fromEntries((entry.highlights ?? []).map((h: string) => [h, full.highlights?.[h]]));
          return [entry.id, { ...full, highlights }];
        }),
      );
    }
    for (const key of missingKeys(base, t)) warn(`${file}: missing "${key}" (falls back to English)`);
  }
}

// ---------- report ----------

for (const w of warnings) console.warn(`warning  ${w}`);
for (const e of errors) console.error(`error    ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
