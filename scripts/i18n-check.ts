// Lists UI strings used with t("…") that have no translation yet. Run: bun scripts/i18n-check.ts
import { Glob } from "bun";
import { DICT } from "../src/lib/dict";

const keys = new Set<string>();
for await (const f of new Glob("src/**/*.{svelte,ts}").scan(".")) {
  const s = await Bun.file(f).text();
  for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
}
// values passed to t() through variables
for (const k of ["Not started", "In review", "Analysed", "On hold", "Highlight", "Area", "Note", "Cell", "yellow", "green", "blue", "pink", "orange", "Projects", "Files", "Annotations", "admin", "editor", "viewer",
  "Structuring (deductive category application)", "Summarizing (inductive category formation)", "Mixed (deductive main categories, inductive subcategories)", "Explication (context analysis)",
  "Categories are defined from theory before coding. Each needs a definition, an anchor example and a coding rule.",
  "Categories are developed from the material: paraphrase each passage, generalize it to the abstraction level, then reduce.",
  "Main categories come from theory; subcategories are formed from the material while coding.",
  "Unclear passages are explained with additional material. Record the explanation in the comment of the passage."]) keys.add(k);

let missing = 0;
for (const [lang, dict] of Object.entries(DICT)) {
  for (const k of [...keys].sort()) {
    if (!(k in dict)) {
      console.log(`[${lang}] ${k}`);
      missing++;
    }
  }
  for (const k of Object.keys(dict)) if (!keys.has(k)) console.log(`[${lang}] unused: ${k}`);
}
console.log(missing ? `${missing} missing` : `all ${keys.size} strings translated`);
