<script lang="ts">
  import { flatFiles, folderOf } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { annoColor } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import FileName from "./FileName.svelte";
  import Icon from "./Icon.svelte";

  type Hit =
    | { kind: "project"; key: string; provider: string; folder: string; number: string; title: string }
    | { kind: "file"; key: string; provider: string; path: string; name: string; where: string }
    | { kind: "anno"; key: string; provider: string; path: string; id: string; text: string; where: string; color: string };

  let query = $state("");
  let cursor = $state(0);
  let listEl = $state<HTMLElement>();

  // Flat index of everything that can be opened; built once per tree load.
  let index = $derived.by(() => {
    const projects: (Hit & { kind: "project"; hay: string })[] = [];
    const files: (Hit & { kind: "file"; hay: string })[] = [];
    for (const p of app.providers) {
      const numbers = new Map(p.projects.map((pr) => [pr.folder, pr.number]));
      for (const pr of p.projects) {
        projects.push({ kind: "project", key: `p:${p.id}:${pr.folder}`, provider: p.id, folder: pr.folder, number: pr.number, title: pr.title, hay: `${pr.number} ${pr.title} ${pr.folder}`.toLowerCase() });
      }
      for (const f of flatFiles(app.trees[p.id] ?? [])) {
        const first = f.path.split("/")[0];
        const project = numbers.has(first) ? first : "";
        const where = [project ? numbers.get(first) || first : p.name, folderOf(f.path, project)].filter(Boolean).join(" / ");
        files.push({ kind: "file", key: `f:${p.id}:${f.path}`, provider: p.id, path: f.path, name: f.name, where, hay: `${f.path} ${app.tagsOf(p.id, f.path).join(" ")}`.toLowerCase() });
      }
    }
    return { projects, files };
  });

  let hits = $derived.by((): Hit[] => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return index.projects;
    const match = (hay: string) => terms.every((t) => hay.includes(t));
    const projects = index.projects.filter((p) => match(p.hay)).slice(0, 6);
    const score = (f: (typeof index.files)[number]) => {
      const name = f.name.toLowerCase();
      return (terms.every((t) => name.includes(t)) ? 0 : 100) + (name.startsWith(terms[0]) ? 0 : 10) + name.length / 100;
    };
    const files = index.files
      .filter((f) => match(f.hay))
      .sort((a, b) => score(a) - score(b))
      .slice(0, 40);
    const annos = app.annotations
      .filter((a) => match(`${a.comment} ${a.quote} ${a.tags.join(" ")}`.toLowerCase()))
      .slice(0, 12)
      .map((a): Hit => ({
        kind: "anno",
        key: `a:${a.id}`,
        provider: a.provider,
        path: a.file,
        id: a.id,
        text: a.comment || a.quote || t("Annotation"),
        where: `${a.file.split("/").pop()}${a.page ? `, ${t("Page {n}", { n: a.page })}` : ""}`,
        color: annoColor(a),
      }));
    return [...projects, ...files, ...annos];
  });

  const close = () => {
    app.paletteOpen = false;
    query = "";
    cursor = 0;
  };

  function choose(h: Hit | undefined, side = false) {
    if (!h) return;
    close();
    if (h.kind === "project") app.openProject(h.provider, h.folder, true);
    else if (h.kind === "file") {
      app.openFile(h.provider, h.path, { pin: true, side });
      const first = h.path.split("/")[0];
      if (app.providers.find((p) => p.id === h.provider)?.projects.some((p) => p.folder === first)) app.revealProject(h.provider, first);
    } else app.openFile(h.provider, h.path, { annoId: h.id });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") return close();
    if (e.key === "Enter") return choose(hits[cursor], e.ctrlKey);
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(1, hits.length);
    listEl?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }

  const label = (kind: Hit["kind"]) => t({ project: "Projects", file: "Files", anno: "Annotations" }[kind]);
</script>

{#if app.paletteOpen}
  <div class="veil" role="presentation" onpointerdown={close}></div>
  <div class="palette" role="dialog" aria-label={t("Search projects, files and annotations")}>
    <div class="input">
      <Icon name="search" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        placeholder={t("Search projects, files, tags and annotations")}
        bind:value={query}
        oninput={() => (cursor = 0)}
        onkeydown={onKey}
        autofocus
        aria-label={t("Search")}
      />
      <kbd>Esc</kbd>
    </div>
    <div class="list" bind:this={listEl} role="listbox">
      {#each hits as h, i (h.key)}
        <button
          role="option"
          aria-selected={i === cursor}
          class={["hit", { on: i === cursor, first: i === 0 || hits[i - 1].kind !== h.kind }]}
          data-group={label(h.kind)}
          onpointermove={() => (cursor = i)}
          onclick={(e) => choose(h, e.ctrlKey)}
        >
          {#if h.kind === "project"}
            <span class="plate">{h.number || "–"}</span>
            <span class="ellipsis main">{h.title}</span>
          {:else if h.kind === "file"}
            <span class="main file"><FileName name={h.name} /></span>
            <span class="where ellipsis">{h.where}</span>
          {:else}
            <i class="dot" style:background={h.color}></i>
            <span class="ellipsis main">{h.text}</span>
            <span class="where ellipsis">{h.where}</span>
          {/if}
        </button>
      {:else}
        <p class="none">{t("Nothing matches “{query}”. Try part of a file name or a project number.", { query })}</p>
      {/each}
    </div>
    <div class="foot muted">
      <span><kbd>↑</kbd> <kbd>↓</kbd> {t("to move")}</span>
      <span><kbd>Enter</kbd> {t("to open")}</span>
      <span><kbd>Ctrl Enter</kbd> {t("to open a file to the side")}</span>
    </div>
  </div>
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(15 20 28 / 0.35);
  }
  .palette {
    position: fixed;
    z-index: 81;
    top: 12vh;
    left: 50%;
    translate: -50% 0;
    width: min(680px, calc(100vw - 32px));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .input {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 48px;
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
    flex: none;
  }
  .input input {
    border: none;
    box-shadow: none;
    padding: 0;
    font-size: 15px;
    background: transparent;
    color: var(--text);
  }
  .list {
    overflow-y: auto;
    padding: 4px 6px 6px;
  }
  .hit {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    text-align: left;
  }
  .hit.first {
    margin-top: 26px;
    position: relative;
  }
  .hit.first::before {
    content: attr(data-group);
    position: absolute;
    left: 10px;
    top: -21px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-3);
  }
  .hit.on {
    background: var(--accent-soft);
  }
  .plate {
    width: 92px;
    flex: none;
    color: var(--accent-text);
  }
  .main {
    min-width: 0;
    flex: 0 1 auto;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .where {
    flex: 1 1 0;
    min-width: 60px;
    text-align: right;
    color: var(--text-3);
    font-size: 12px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
  }
  .none {
    margin: 20px 12px;
    color: var(--text-2);
  }
  .foot {
    display: flex;
    gap: 18px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    flex: none;
  }
</style>
