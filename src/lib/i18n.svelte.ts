// Localization. English text is the key; other languages live in dict.ts.
// Usage: t("Open folder") or t("{n} files", { n: 3 }). Missing entries fall back to English.
import { DICT } from "./dict";

export type Lang = "en" | "de";
export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
];

const stored = localStorage.getItem("analyzer.lang") as Lang | null;
export const i18n = $state<{ lang: Lang }>({
  lang: stored && LANGS.some((l) => l.id === stored) ? stored : navigator.language.toLowerCase().startsWith("de") ? "de" : "en",
});
document.documentElement.lang = i18n.lang;

export function setLang(lang: Lang) {
  i18n.lang = lang;
  document.documentElement.lang = lang;
  localStorage.setItem("analyzer.lang", lang);
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = (i18n.lang === "en" ? undefined : DICT[i18n.lang]?.[text]) ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}
