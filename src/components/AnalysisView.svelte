<script lang="ts">
  import type { Annotation } from "../lib/api";
  import { segmentColumns, segmentViews } from "../lib/columns";
  import { t } from "../lib/i18n.svelte";
  import { qia, type Analysis, type Category } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import { ws, type Tab } from "../lib/workspace.svelte";
  import DataTable from "./DataTable.svelte";
  import Icon from "./Icon.svelte";

  // One content analysis. Design and category system belong to the whole study;
  // segments and matrix show what was coded inside the provider or project this tab is open in.
  let { tab }: { tab: Tab } = $props();

  let analysis = $derived(qia.analyses.find((a) => a.id === tab.path));
  let section = $derived(tab.view?.table ?? "design");
  let inProject = $derived(!!tab.project);
  let scopeName = $derived(inProject ? (app.project(tab.provider, tab.project)?.number ?? tab.project) : (app.provider(tab.provider)?.name ?? tab.provider));

  let tree = $derived(qia.tree(tab.path));
  let segments = $derived(
    app.annotations.filter((a) => a.analysis === tab.path && a.category && a.provider === tab.provider && (!inProject || a.project === tab.project)),
  );
  let uncoded = $derived(
    app.annotations.filter((a) => a.analysis === tab.path && !a.category && a.provider === tab.provider && (!inProject || a.project === tab.project)).length,
  );
  let material = $derived(
    qia.material.filter((m) => m.analysis === tab.path && m.provider === tab.provider && (!inProject || m.file.startsWith(tab.project + "/"))),
  );
  let summarizing = $derived(analysis?.technique === "inductive" || analysis?.technique === "mixed");

  // ---------- design form ----------
  let saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let confirmDelete = $state(false);

  function edit(patch: Partial<Analysis>) {
    if (!analysis) return;
    const next = { ...$state.snapshot(analysis), ...patch } as Analysis;
    const i = qia.analyses.findIndex((a) => a.id === next.id);
    qia.analyses[i] = next;
    if (patch.name !== undefined) tab.title = patch.name || t("Analysis");
    saveState = "saving";
    clearTimeout(timer);
    timer = setTimeout(() => {
      qia.saveAnalysis(next).then(
        () => (saveState = "saved"),
        () => (saveState = "error"),
      );
    }, 500);
  }

  type Key = keyof Analysis;
  let steps = $derived<{ title: string; hint: string; fields: { key: Key; label: string; rows?: number; placeholder?: string }[] }[]>([
    {
      title: t("1. Material"),
      hint: t("Which documents are analysed, where they come from, and in what form they exist."),
      fields: [
        { key: "material", label: t("Definition of the material"), rows: 2, placeholder: t("e.g. all AIA documents of the tenders from 2022 to 2025") },
        { key: "origin", label: t("Situation of origin"), rows: 2, placeholder: t("Who wrote the documents, for whom, and for what purpose?") },
        { key: "formal", label: t("Formal characteristics"), rows: 2, placeholder: t("e.g. PDF tender documents, partly scanned") },
      ],
    },
    {
      title: t("2. Question"),
      hint: t("What the analysis should find out, and the theory it builds on."),
      fields: [
        { key: "direction", label: t("Direction of the analysis"), rows: 2, placeholder: t("Statements about the content, the author, or the effect on the reader?") },
        { key: "question", label: t("Research question"), rows: 3 },
        { key: "theory", label: t("Theoretical background"), rows: 3 },
      ],
    },
  ]);
  let units = $derived<{ key: Key; label: string; placeholder: string }[]>([
    { key: "codingUnit", label: t("Coding unit"), placeholder: t("Smallest text part that may be coded, e.g. a clause") },
    { key: "contextUnit", label: t("Context unit"), placeholder: t("Largest text part that may fall under one category, e.g. a section") },
    { key: "evaluationUnit", label: t("Evaluation unit"), placeholder: t("Which parts are evaluated one after another, e.g. each document") },
  ]);
  const TECHNIQUES = ["deductive", "inductive", "mixed", "explication"] as const;
  const TECH_LABEL = {
    deductive: "Structuring (deductive category application)",
    inductive: "Summarizing (inductive category formation)",
    mixed: "Mixed (deductive main categories, inductive subcategories)",
    explication: "Explication (context analysis)",
  };
  const TECH_HELP = {
    deductive: "Categories are defined from theory before coding. Each needs a definition, an anchor example and a coding rule.",
    inductive: "Categories are developed from the material: paraphrase each passage, generalize it to the abstraction level, then reduce.",
    mixed: "Main categories come from theory; subcategories are formed from the material while coding.",
    explication: "Unclear passages are explained with additional material. Record the explanation in the comment of the passage.",
  };

  // ---------- category system ----------
  let open = $state<Record<string, boolean>>({});
  let counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of segments) m.set(a.category, (m.get(a.category) ?? 0) + 1);
    return m;
  });
  const saveCat = (cat: Category, patch: Partial<Category>) => qia.saveCategory({ ...$state.snapshot(cat), ...patch } as Category);

  async function addCategory(parent: string) {
    const created = await qia.addCategory(tab.path, parent, parent ? t("New subcategory") : t("New category"));
    open[created.id] = true;
  }

  // ---------- matrix ----------
  let columns = $derived.by(() => {
    if (inProject) {
      const files = [...new Set([...segments.map((a) => a.file), ...material.map((m) => m.file)])].sort();
      return files.map((f) => ({ key: f, label: f.split("/").pop() ?? f, title: f }));
    }
    const folders = [...new Set([...segments.map((a) => a.project), ...material.map((m) => app.projectOf(m.provider, m.file))])].sort();
    return folders.map((f) => ({ key: f, label: app.project(tab.provider, f)?.number || f || t("Provider files"), title: app.project(tab.provider, f)?.title ?? f }));
  });
  let matrix = $derived.by(() => {
    const cell = new Map<string, number>();
    const bump = (k: string) => cell.set(k, (cell.get(k) ?? 0) + 1);
    for (const a of segments) {
      const col = inProject ? a.file : a.project;
      // a segment counts for its category and every category above it
      for (let c = qia.category(a.category); c; c = qia.category(c.parent)) {
        bump(`${c.id}|${col}`);
        bump(`${c.id}|`);
      }
    }
    return cell;
  });
  let peak = $derived(Math.max(1, ...columns.flatMap((col) => tree.map(({ cat }) => matrix.get(`${cat.id}|${col.key}`) ?? 0))));

  const openSegment = (a: Annotation) => app.openFile(a.provider, a.file, { annoId: a.id });
  const autosize = "field-sizing: content";
</script>

{#if !analysis}
  <div class="gone">
    <p>{t("This analysis no longer exists.")}</p>
    <button class="btn" onclick={() => ws.close(tab.id)}>{t("Close")}</button>
  </div>
{:else}
  <div class="av">
    <header>
      <div class="head-main">
        <p class="what">{t("Qualitative content analysis")}</p>
        <h1>{analysis.name}</h1>
        <p class="facts">
          <span>{t("{n} categories", { n: tree.length })}</span>
          <span>{t("{n} coded segments in {scope}", { n: segments.length, scope: scopeName })}</span>
          <span>{t("{done} of {n} documents coded", { done: material.filter((m) => m.state === "coded").length, n: material.length })}</span>
        </p>
      </div>
      {#if qia.activeId !== analysis.id}
        <button class="btn primary" onclick={() => qia.setActive(analysis.id)} title={t("New codings in documents then go to this analysis")}>{t("Code with this analysis")}</button>
      {:else}
        <span class="active">{t("Active for coding")}</span>
      {/if}
    </header>

    <div class="levels" role="tablist">
      {#each [["design", t("Design")], ["categories", t("Category system")], ["segments", t("Coded segments")], ["matrix", t("Matrix")]] as [id, label] (id)}
        <button role="tab" aria-selected={section === id} class={{ on: section === id }} onclick={() => (tab.view = { ...tab.view, table: id })}>
          {label}
          {#if id === "categories"}<span>{tree.length}</span>{:else if id === "segments"}<span>{segments.length}</span>{/if}
        </button>
      {/each}
    </div>

    {#if section === "design"}
      <div class="scroll">
        <div class="design">
          <p class="lead">
            {t("These settings apply to the whole study, in every project and document, so that all material is coded by the same rules.")}
          </p>
          <label>{t("Name of the analysis")} <input type="text" value={analysis.name} oninput={(e) => edit({ name: e.currentTarget.value })} /></label>

          {#each steps as step (step.title)}
            <section>
              <h2>{step.title}</h2>
              <p class="hint">{step.hint}</p>
              {#each step.fields as f (f.key)}
                <label>
                  {f.label}
                  <textarea rows={f.rows ?? 2} style={autosize} placeholder={f.placeholder} value={analysis[f.key]} oninput={(e) => edit({ [f.key]: e.currentTarget.value })}></textarea>
                </label>
              {/each}
            </section>
          {/each}

          <section>
            <h2>{t("3. Technique")}</h2>
            <p class="hint">{t("How categories come about. This decides which fields you fill in while coding.")}</p>
            <div class="radios">
              {#each TECHNIQUES as tech (tech)}
                <label class={["radio", { on: analysis.technique === tech }]}>
                  <input type="radio" name="tech-{tab.id}" checked={analysis.technique === tech} onchange={() => edit({ technique: tech })} />
                  <span><b>{t(TECH_LABEL[tech])}</b><br /><span class="muted">{t(TECH_HELP[tech])}</span></span>
                </label>
              {/each}
            </div>
            {#if summarizing}
              <label>
                {t("Selection criterion")}
                <textarea rows="2" style={autosize} placeholder={t("Which passages are relevant at all? Everything else is skipped.")} value={analysis.selection} oninput={(e) => edit({ selection: e.currentTarget.value })}></textarea>
              </label>
              <label>
                {t("Level of abstraction")}
                <textarea rows="2" style={autosize} placeholder={t("How general should categories be, e.g. concrete requirements per deliverable")} value={analysis.abstraction} oninput={(e) => edit({ abstraction: e.currentTarget.value })}></textarea>
              </label>
            {/if}
          </section>

          <section>
            <h2>{t("4. Units of analysis")}</h2>
            <p class="hint">{t("They fix how small and how large a coded passage may be.")}</p>
            {#each units as f (f.key)}
              <label>{f.label} <input type="text" placeholder={f.placeholder} value={analysis[f.key]} oninput={(e) => edit({ [f.key]: e.currentTarget.value })} /></label>
            {/each}
          </section>

          <section>
            <h2>{t("5. Checks and log")}</h2>
            <p class="hint">{t("Revise the category system after 10 to 50 percent of the material, then code everything again with the final version.")}</p>
            <label>
              {t("Quality criteria")}
              <textarea rows="2" style={autosize} placeholder={t("e.g. second coding of a sample after two weeks (intracoder check)")} value={analysis.quality} oninput={(e) => edit({ quality: e.currentTarget.value })}></textarea>
            </label>
            <label>
              {t("Process log")}
              <textarea rows="3" style={autosize} placeholder={t("What was changed in the category system, when and why?")} value={analysis.notes} oninput={(e) => edit({ notes: e.currentTarget.value })}></textarea>
            </label>
          </section>

          <div class="foot">
            <span class="muted" aria-live="polite">
              {saveState === "saving" ? t("Saving…") : saveState === "saved" ? t("Saved") : saveState === "error" ? t("Not saved, server unreachable") : ""}
            </span>
            {#if confirmDelete}
              <span>{t("Delete this analysis and its categories? Marked passages stay as plain annotations.")}</span>
              <button class="btn" onclick={() => (confirmDelete = false)}>{t("Cancel")}</button>
              <button
                class="btn danger"
                onclick={() => {
                  const id = analysis.id;
                  ws.close(tab.id);
                  for (const a of app.annotations) if (a.analysis === id) a.analysis = a.category = "";
                  void qia.deleteAnalysis(id);
                }}>{t("Delete analysis")}</button
              >
            {:else}
              <button class="link danger" onclick={() => (confirmDelete = true)}>{t("Delete analysis")}</button>
            {/if}
          </div>
        </div>
      </div>
    {:else if section === "categories"}
      <div class="scroll">
        <div class="cats">
          <p class="lead">
            {t("The coding guide. For every category write down what belongs to it, a typical passage, and how to decide borderline cases.")}
          </p>
          {#each tree as { cat, depth } (cat.id)}
            <div class={["cat", { sub: depth > 0 }]} style:margin-left="{depth * 26}px">
              <div class="cat-head">
                <button class={["twist", { open: open[cat.id] }]} onclick={() => (open[cat.id] = !open[cat.id])} aria-expanded={!!open[cat.id]} aria-label={t("Show details")}>
                  <Icon name="chevron" size={12} />
                </button>
                <input class="swatch" type="color" value={cat.color} title={t("Colour")} onchange={(e) => saveCat(cat, { color: e.currentTarget.value })} />
                <input class="cname" type="text" value={cat.name} aria-label={t("Category name")} onchange={(e) => saveCat(cat, { name: e.currentTarget.value.trim() || cat.name })} />
                <span class="ccount" title={t("Coded segments in {scope}", { scope: scopeName })}>{(matrix.get(`${cat.id}|`) ?? 0) || ""}</span>
                {#if !cat.definition}<span class="warn" title={t("No definition yet")}>{t("no definition")}</span>{/if}
                <button class="icon-btn" title={t("Add subcategory")} onclick={() => addCategory(cat.id)}><Icon name="plus" size={13} /></button>
                <button
                  class="icon-btn"
                  title={counts.get(cat.id) ? t("Delete category. Its {n} segments lose their category.", { n: counts.get(cat.id) ?? 0 }) : t("Delete category")}
                  onclick={() => qia.deleteCategory(cat.id, app.annotations)}><Icon name="trash" size={13} /></button
                >
              </div>
              {#if open[cat.id]}
                <div class="cat-body">
                  <label>{t("Definition")} <textarea rows="2" style={autosize} placeholder={t("Which passages fall under this category?")} value={cat.definition} onchange={(e) => saveCat(cat, { definition: e.currentTarget.value })}></textarea></label>
                  <label>{t("Anchor example")} <textarea rows="2" style={autosize} placeholder={t("A passage from the material that is typical for this category")} value={cat.anchor} onchange={(e) => saveCat(cat, { anchor: e.currentTarget.value })}></textarea></label>
                  <label>{t("Coding rule")} <textarea rows="2" style={autosize} placeholder={t("How to decide when a passage could also fit another category")} value={cat.rule} onchange={(e) => saveCat(cat, { rule: e.currentTarget.value })}></textarea></label>
                </div>
              {/if}
            </div>
          {:else}
            <p class="muted">
              {summarizing
                ? t("No categories yet. With inductive category formation you create them while coding: mark a passage in a document and choose “New category”.")
                : t("No categories yet. Define the main categories from your theory before you start coding.")}
            </p>
          {/each}
          <button class="btn" onclick={() => addCategory("")}><Icon name="plus" size={13} /> {t("Add main category")}</button>
        </div>
      </div>
    {:else if section === "segments"}
      {#if uncoded}<p class="note">{t("{n} marked passages in {scope} have no category yet.", { n: uncoded, scope: scopeName })}</p>{/if}
      <DataTable
        kind="segments"
        columns={segmentColumns(summarizing)}
        rows={segments}
        rowKey={(a: Annotation) => a.id}
        builtins={segmentViews()}
        empty={t("Nothing coded here yet. Open a document, mark a passage and assign a category.")}
        onOpen={openSegment}
      />
    {:else}
      <div class="scroll">
        {#if !tree.length || !columns.length}
          <p class="muted pad">{t("The matrix fills up as soon as passages are coded. Rows are categories, columns are {what}.", { what: inProject ? t("documents") : t("projects") })}</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th class="first">{t("Category")}</th>
                {#each columns as col (col.key)}<th title={col.title}><span>{col.label}</span></th>{/each}
                <th class="total">{t("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {#each tree as { cat, depth } (cat.id)}
                <tr class={{ main: depth === 0 }}>
                  <td class="first" style:padding-left="{12 + depth * 18}px"><i style:background={cat.color}></i>{cat.name}</td>
                  {#each columns as col (col.key)}
                    {@const n = matrix.get(`${cat.id}|${col.key}`) ?? 0}
                    <td class="num" style:background={n ? `color-mix(in srgb, ${cat.color} ${Math.round(12 + (n / peak) * 55)}%, transparent)` : undefined}>{n || ""}</td>
                  {/each}
                  <td class="num total">{matrix.get(`${cat.id}|`) ?? 0}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="muted pad">{t("Main categories include the segments of their subcategories.")}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .av {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
  }
  .gone {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    height: 100%;
    color: var(--text-2);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 16px 16px 12px;
    flex: none;
  }
  .head-main {
    flex: 1;
    min-width: 0;
  }
  .what {
    margin: 0 0 1px;
    font-size: 12px;
    color: var(--text-3);
  }
  h1 {
    font-size: 21px;
    font-weight: 650;
    letter-spacing: -0.015em;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    margin: 3px 0 0;
    color: var(--text-2);
  }
  .facts span:not(:last-child)::after {
    content: "";
    display: inline-block;
    width: 1px;
    height: 11px;
    margin: 0 10px;
    background: var(--border-strong);
    vertical-align: -1px;
  }
  .active {
    padding: 4px 10px;
    border-radius: 13px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
  }
  .levels {
    display: flex;
    gap: 6px;
    padding: 0 16px 10px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .levels button {
    height: 26px;
    padding: 0 10px;
    border-radius: 13px;
    background: var(--surface-2);
    color: var(--text-2);
    white-space: nowrap;
  }
  .levels button span {
    color: var(--text-3);
    margin-left: 3px;
  }
  .levels button:hover {
    background: var(--surface-3);
  }
  .levels button.on {
    background: var(--text);
    color: var(--surface);
    font-weight: 600;
  }
  .levels button.on span {
    color: inherit;
    opacity: 0.7;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .design,
  .cats {
    max-width: 760px;
    padding: 16px 16px 48px;
  }
  .lead {
    margin: 0 0 16px;
    color: var(--text-2);
    max-width: 68ch;
  }
  section {
    margin-top: 26px;
  }
  h2 {
    font-size: 15px;
    font-weight: 650;
  }
  .hint {
    margin: 2px 0 10px;
    color: var(--text-3);
    font-size: 12.5px;
  }
  label {
    display: block;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--text-2);
  }
  label :is(input[type="text"], textarea) {
    margin-top: 3px;
    color: var(--text);
    font-size: 13px;
    min-height: 0;
  }
  .radios {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }
  .radio {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }
  .radio.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .radio input {
    margin-top: 3px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .foot .muted {
    margin-right: auto;
  }
  .link.danger,
  .btn.danger {
    color: var(--danger);
  }
  .btn.danger {
    border-color: var(--danger);
  }
  .cat {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 6px;
  }
  .cat.sub {
    background: var(--surface-2);
  }
  .cat-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
  }
  .twist {
    display: grid;
    place-items: center;
    width: 20px;
    height: 24px;
    color: var(--text-3);
    transition: transform 100ms;
  }
  .twist.open {
    transform: rotate(90deg);
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    flex: none;
  }
  .cname {
    flex: 1;
    min-width: 80px;
    border-color: transparent;
    background: transparent;
    font-weight: 600;
    padding: 3px 6px;
  }
  .cname:hover {
    border-color: var(--border-strong);
  }
  .ccount {
    min-width: 20px;
    text-align: right;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .warn {
    font-size: 11.5px;
    color: var(--text-3);
    white-space: nowrap;
  }
  .cat-body {
    padding: 4px 12px 6px 34px;
  }
  .note {
    margin: 0;
    padding: 8px 16px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    flex: none;
  }
  .pad {
    margin: 0;
    padding: 14px 16px;
  }
  table {
    border-collapse: collapse;
    font-size: 12.5px;
    margin: 4px 0 0;
  }
  th,
  td {
    border-bottom: 1px solid var(--border);
    height: 30px;
    padding: 0 10px;
    white-space: nowrap;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-2);
    font-weight: 600;
    color: var(--text-2);
    text-align: right;
    max-width: 150px;
  }
  th span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .first {
    position: sticky;
    left: 0;
    text-align: left;
    background: var(--surface);
    min-width: 240px;
    padding-left: 12px;
  }
  th.first {
    z-index: 2;
    background: var(--surface-2);
  }
  td.first i {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 8px;
  }
  tr.main td {
    font-weight: 600;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .total {
    border-left: 1px solid var(--border-strong);
    background: var(--surface-2);
  }
</style>
