<script lang="ts">
  import { COLORS, type Annotation } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { annoColor, qia } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let {
    annos,
    provider,
    path,
    onReveal,
    onAddNote,
  }: { annos: Annotation[]; provider: string; path: string; onReveal: (a: Annotation) => void; onAddNote: () => void } = $props();

  // Coding: with an active analysis every passage gets a category select, and for
  // summarizing techniques the three reduction steps.
  let naming = $state<string | null>(null); // annotation that is getting a new category
  let matState = $derived(qia.active ? qia.materialState(qia.activeId, provider, path) : "");

  function pickCategory(a: Annotation, analysis: string, value: string) {
    if (value === "__new") return void (naming = a.id);
    void app.updateAnnotation(a.id, { analysis, category: value });
  }

  async function newCategory(a: Annotation, analysis: string, name: string) {
    naming = null;
    if (!name.trim()) return;
    // from an already chosen category the new one becomes its subcategory
    const created = await qia.addCategory(analysis, qia.main(a.category)?.id ?? "", name.trim());
    await app.updateAnnotation(a.id, { analysis, category: created.id });
  }

  const focusNow = (el: HTMLInputElement) => el.focus();

  let sorted = $derived(
    [...annos].sort(
      (a, b) =>
        (a.page ?? 0) - (b.page ?? 0) ||
        (a.anchor?.rects?.[0]?.y ?? a.anchor?.r ?? 0) - (b.anchor?.rects?.[0]?.y ?? b.anchor?.r ?? 0) ||
        a.created - b.created,
    ),
  );

  const where = (a: Annotation) =>
    a.kind === "cell" ? `${a.anchor?.sheet} ${a.anchor?.ref}` : a.page ? t("Page {n}", { n: a.page }) : t("Whole document");
  const kindLabel: Record<Annotation["kind"], string> = { highlight: "Highlight", area: "Area", note: "Note", cell: "Cell", doc: "Note" };

  function focusWhenNew(a: Annotation) {
    return (el: HTMLElement) => {
      if (app.focusedAnno !== a.id) return;
      el.scrollIntoView({ block: "nearest" });
      if (!a.comment && Date.now() - a.created < 3000) el.querySelector("textarea")?.focus({ preventScroll: true });
    };
  }

  const parseTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))];
</script>

{#snippet coding(a: Annotation)}
  {@const aid = a.analysis || qia.activeId}
  {@const study = qia.analyses.find((x) => x.id === aid)}
  {#if study}
    {@const cat = qia.category(a.category)}
    <div class="coding">
      {#if naming === a.id}
        <input
          type="text"
          placeholder={cat ? t("Name of the new subcategory of “{name}”", { name: qia.main(a.category)?.name ?? "" }) : t("Name of the new category")}
          onkeydown={(e) => (e.key === "Enter" ? newCategory(a, aid, e.currentTarget.value) : e.key === "Escape" && (naming = null))}
          onblur={(e) => newCategory(a, aid, e.currentTarget.value)}
          {@attach focusNow}
        />
      {:else}
        <select aria-label={t("Category")} value={a.category} onchange={(e) => pickCategory(a, aid, e.currentTarget.value)}>
          <option value="">{t("No category")}</option>
          {#each qia.tree(aid) as node (node.cat.id)}
            <option value={node.cat.id}>{"\u2003".repeat(node.depth)}{node.cat.name}</option>
          {/each}
          <option value="__new">{cat ? t("New subcategory…") : t("New category…")}</option>
        </select>
      {/if}
      {#if cat && (cat.definition || cat.rule)}
        <p class="def" title={[cat.definition, cat.rule].filter(Boolean).join("\n\n")}>{cat.definition || cat.rule}</p>
      {/if}
      {#if a.category && (study.technique === "inductive" || study.technique === "mixed")}
        {#each [["paraphrase", t("Paraphrase")], ["generalization", t("Generalization")], ["reduction", t("Reduction")]] as const as [key, label] (key)}
          <textarea rows="1" placeholder={label} aria-label={label} value={a[key]} onchange={(e) => app.updateAnnotation(a.id, { [key]: e.currentTarget.value })}></textarea>
        {/each}
      {/if}
      {#if aid !== qia.activeId}<p class="def">{t("Coded in “{name}”", { name: study.name })}</p>{/if}
    </div>
  {/if}
{/snippet}

<div class="annos">
  <div class="head">
    <span class="muted">{t("{n} annotations", { n: annos.length })}</span>
    <button class="btn" onclick={onAddNote} title={t("Add a note about the whole document")}><Icon name="plus" size={13} /> {t("Note")}</button>
  </div>
  {#if qia.active}
    <div class="matbar">
      <label title={t("Counts this document as part of the material of “{name}”", { name: qia.active.name })}>
        <input type="checkbox" checked={matState !== ""} onchange={(e) => qia.setMaterial(qia.activeId, provider, path, e.currentTarget.checked ? "included" : "")} />
        {t("In the material")}
      </label>
      <label>
        <input type="checkbox" checked={matState === "coded"} disabled={matState === ""} onchange={(e) => qia.setMaterial(qia.activeId, provider, path, e.currentTarget.checked ? "coded" : "included")} />
        {t("Coding finished")}
      </label>
    </div>
  {/if}
  <div class="list">
    {#each sorted as a (a.id)}
      <article class={{ focused: app.focusedAnno === a.id }} style:--c={annoColor(a)} {@attach focusWhenNew(a)}>
        <div class="top">
          <button
            class="where"
            onclick={() => {
              app.focusedAnno = a.id;
              onReveal(a);
            }}
            title={t("Show in document")}>{where(a)}</button
          >
          <span class="kind">{t(kindLabel[a.kind])}{#if a.author}<span class="author" title={a.author}> · {a.author.split("@")[0]}</span>{/if}</span>
          <button class="icon-btn" title={t("Delete annotation")} onclick={() => app.removeAnnotation(a.id)}><Icon name="trash" size={13} /></button>
        </div>
        {#if a.quote}<blockquote>{a.quote}</blockquote>{/if}
        {@render coding(a)}
        <textarea
          rows="2"
          placeholder={t("Add a comment")}
          value={a.comment}
          aria-label={t("Comment")}
          onfocus={() => (app.focusedAnno = a.id)}
          onchange={(e) => app.updateAnnotation(a.id, { comment: e.currentTarget.value })}
        ></textarea>
        <div class="bottom">
          <input
            type="text"
            class="tags"
            placeholder={t("Tags, comma separated")}
            value={a.tags.join(", ")}
            aria-label={t("Tags")}
            onchange={(e) => app.updateAnnotation(a.id, { tags: parseTags(e.currentTarget.value) })}
          />
          {#if !a.category}
          <span class="colors">
            {#each Object.entries(COLORS) as [name, hex] (name)}
              <button
                class={["dot", { on: a.color === name }]}
                style:background={hex}
                aria-label={t(name)}
                title={t(name)}
                onclick={() => app.updateAnnotation(a.id, { color: name })}
              ></button>
            {/each}
          </span>
          {/if}
        </div>
      </article>
    {:else}
      <p class="empty">
        {t("Nothing annotated in this document yet. In a PDF, select text to highlight it, or use the area and note tools. In a spreadsheet, select a cell and choose “Annotate cell”.")}
      </p>
    {/each}
  </div>
</div>

<style>
  .annos {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 38px;
    padding: 0 8px 0 12px;
    font-size: 12px;
    flex: none;
  }
  .head .btn {
    height: 24px;
    font-size: 12.5px;
    font-weight: 400;
  }
  .matbar {
    display: flex;
    gap: 14px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-2);
    flex: none;
  }
  .matbar label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .coding {
    display: grid;
    gap: 4px;
    margin-bottom: 6px;
  }
  .coding select {
    height: 26px;
    padding: 0 6px;
    border-left: 3px solid var(--c);
    font-weight: 600;
  }
  .coding textarea {
    min-height: 26px;
    font-size: 12.5px;
    padding: 3px 7px;
  }
  .def {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-3);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  article {
    background: var(--paper);
    border: 1px solid var(--border);
    border-left: 3px solid var(--c);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 6px 8px 8px;
    margin-bottom: 8px;
  }
  article.focused {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .where {
    color: var(--accent-text);
    font-weight: 600;
  }
  .where:hover {
    text-decoration: underline;
  }
  .kind {
    color: var(--ink-3);
    font-size: 12px;
    margin-right: auto;
  }
  blockquote {
    margin: 4px 0 6px;
    font-family: var(--font-text);
    font-size: 12.5px;
    color: var(--ink-2);
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  textarea {
    font-size: 13px;
    padding: 5px 7px;
    min-height: 34px;
    field-sizing: content;
  }
  .bottom {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .tags {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    padding: 3px 6px;
  }
  .colors {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    opacity: 0.55;
  }
  .dot.on,
  .dot:hover {
    opacity: 1;
    box-shadow: 0 0 0 2px var(--paper), 0 0 0 3.5px var(--ink);
  }
  .empty {
    color: var(--ink-2);
    font-size: 13px;
    margin: 8px 6px;
  }
</style>
