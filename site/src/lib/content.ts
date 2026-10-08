// Loads everything from the repo's content/ folder at build time.
// Data (content/data) and text (content/i18n/<lang>) are merged here, with
// missing keys falling back to English. Never hard-code resume text in site/.

type Json = any;

const dataFiles = import.meta.glob<Json>('../../../content/data/*.json', { eager: true, import: 'default' });
const i18nFiles = import.meta.glob<Json>('../../../content/i18n/*/*.json', { eager: true, import: 'default' });
const iconFiles = import.meta.glob<string>('../../../content/icons/*.{png,svg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const resumeFiles = import.meta.glob<string>('../../../content/resume/*.pdf', {
  eager: true,
  query: '?url',
  import: 'default',
});

const FALLBACK = 'en';

function data(name: string): Json {
  const file = dataFiles[`../../../content/data/${name}.json`];
  if (!file) throw new Error(`content/data/${name}.json not found`);
  return file;
}

function isObject(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: Json, over: Json): Json {
  if (!isObject(base) || !isObject(over)) return over ?? base;
  const out: Record<string, Json> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

function text(lang: string, name: string): Json {
  const en = i18nFiles[`../../../content/i18n/${FALLBACK}/${name}.json`] ?? {};
  if (lang === FALLBACK) return en;
  return deepMerge(en, i18nFiles[`../../../content/i18n/${lang}/${name}.json`] ?? {});
}

function iconUrl(file?: string): string | undefined {
  return file ? iconFiles[`../../../content/icons/${file}`] : undefined;
}

export interface Highlight { id: string; metric: string; text: string }
export interface SkillRef { id: string; name: string; color: string; icon?: string; listed: boolean }
export interface UsedIn { anchor: string; label: string }
export interface Skill extends SkillRef {
  category: string;
  element: string;
  children: Skill[];
  usedIn: UsedIn[];
}

const profileData = data('profile');
export const languages: string[] = profileData.languages;
export const defaultLanguage: string = profileData.defaultLanguage;

export function loadContent(lang: string) {
  const elements: Record<string, { role: string; categories: string[]; color: string }> = data('elements');
  const ui = text(lang, 'ui');

  const elementOf = (s: Json): string =>
    s.game?.element ??
    Object.entries(elements).find(([, e]) => e.categories.includes(s.category))?.[0] ??
    'neutral';

  // Skills
  const skillText = text(lang, 'skills');
  const skills: Skill[] = data('skills').map((s: Json) => {
    const element = elementOf(s);
    return {
      id: s.id,
      name: skillText[s.id]?.name ?? s.name,
      category: s.category,
      element,
      color: elements[element].color,
      icon: iconUrl(s.icon),
      listed: s.listed !== false,
      children: [],
      usedIn: [],
    };
  });
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const refs = (ids: string[]): SkillRef[] =>
    ids.map((id) => skillById.get(id)).filter((s): s is Skill => !!s);

  const highlights = (ids: string[], t: Json): Highlight[] =>
    ids.map((id) => ({ id, metric: t?.highlights?.[id]?.metric ?? '', text: t?.highlights?.[id]?.text ?? '' }));

  // Experience
  const expText = text(lang, 'experience');
  const experience = data('experience').map((e: Json) => {
    const t = expText[e.id] ?? {};
    return {
      id: e.id,
      org: t.org ?? e.org,
      title: t.title,
      location: t.location,
      country: e.country as string | undefined,
      summary: t.summary,
      start: e.start as string,
      end: e.end as string | null,
      skills: refs(e.skills),
      highlights: highlights(e.highlights, t),
    };
  });

  // Projects
  const projText = text(lang, 'projects');
  const projects = data('projects').map((p: Json) => {
    const t = projText[p.id] ?? {};
    return {
      id: p.id,
      name: t.name ?? p.id,
      summary: t.summary,
      status: p.status as string,
      start: p.start as string,
      end: p.end as string | null,
      links: p.links as { type: string; url: string }[],
      codeOnRequest: !!p.codeOnRequest,
      skills: refs(p.skills),
      highlights: highlights(p.highlights, t),
    };
  });

  // Education
  const eduText = text(lang, 'education');
  const education = data('education').map((e: Json) => ({ ...e, ...eduText[e.id] }));

  // "Used in" is computed, never written by hand.
  for (const e of experience) for (const s of e.skills) skillById.get(s.id)!.usedIn.push({ anchor: `exp-${e.id}`, label: `${e.org} · ${e.title}` });
  for (const p of projects) for (const s of p.skills) skillById.get(s.id)!.usedIn.push({ anchor: `proj-${p.id}`, label: p.name });
  for (const e of education) for (const id of e.skills ?? []) skillById.get(id)?.usedIn.push({ anchor: `edu-${e.id}`, label: e.school });

  // Child skills (EC2 under AWS) are grouped under their parent.
  const rawSkills = data('skills') as Json[];
  for (const raw of rawSkills) {
    if (raw.parent && raw.listed !== false) skillById.get(raw.parent)?.children.push(skillById.get(raw.id)!);
  }
  const parentOf = new Map(rawSkills.filter((s) => s.parent).map((s) => [s.id, s.parent as string]));
  const categories = Object.keys(ui.categories).map((cat) => ({
    id: cat,
    label: ui.categories[cat] as string,
    skills: skills.filter((s) => s.category === cat && s.listed && !parentOf.has(s.id)),
  })).filter((c) => c.skills.length > 0);

  // Resume PDFs only appear if the file exists in content/resume/.
  const resumes = Object.entries(profileData.resumePdf as Record<string, string>)
    .map(([kind, path]) => ({ kind, url: resumeFiles[`../../../content/${path}`], fileName: path.split('/').pop()! }))
    .filter((r): r is { kind: string; url: string; fileName: string } => !!r.url);

  const profile = { ...profileData, ...text(lang, 'profile'), resumes };

  const playable = !!data('game').playable;

  return { lang, ui, profile, experience, projects, education, categories, elements, playable };
}

export type Content = ReturnType<typeof loadContent>;

export function formatMonth(value: string | null | undefined, lang: string, ui: Json): string {
  if (!value) return ui.labels.present;
  const [y, m] = value.split('-').map(Number);
  if (!m) return String(y);
  return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatRange(start: string, end: string | null, lang: string, ui: Json): string {
  return `${formatMonth(start, lang, ui)} – ${formatMonth(end, lang, ui)}`;
}
