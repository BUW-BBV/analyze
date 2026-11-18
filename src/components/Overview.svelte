<script lang="ts">
  import { formatSize, type Annotation } from "../lib/api";
  import {
    annotationColumns,
    annotationViews,
    documentColumns,
    documentRows,
    documentViews,
    projectColumns,
    projectRows,
    projectViews,
    type DocRow,
    type ProjectRow,
  } from "../lib/columns";
  import { t } from "../lib/i18n.svelte";
  import { fileMenu, projectMenu } from "../lib/menus";
  import { app } from "../lib/state.svelte";
  import type { Tab } from "../lib/workspace.svelte";
  import DataTable from "./DataTable.svelte";
  import Icon from "./Icon.svelte";
  import InfoPanel from "./InfoPanel.svelte";

  // Overview of a provider (its projects) or a project (its documents).
  let { tab }: { tab: Tab } = $props();

  let provider = $derived(app.provider(tab.provider));
  let project = $derived(tab.kind === "project" ? app.project(tab.provider, tab.project) : undefined);
  let isProvider = $derived(tab.kind === "provider");

  let projects = $derived(provider && isProvider ? projectRows(provider) : []);
  let docs = $derived(
    isProvider
      ? documentRows(tab.provider, provider?.files ?? [], "")
      : documentRows(tab.provider, app.projectTree(tab.provider, tab.project) ?? [], tab.project),
  );
  let annos = $derived(app.annotations.filter((a) => a.provider === tab.provider && (isProvider || a.project === tab.project)));

  let tables = $derived(
    isProvider
      ? [
          { id: "projects", label: t("Projects"), n: projects.length },
          { id: "documents", label: t("Provider files"), n: docs.length },
          { id: "annotations", label: t("Annotations"), n: annos.length },
        ]
      : [
          { id: "documents", label: t("Documents"), n: docs.length },
          { id: "annotations", label: t("Annotations"), n: annos.length },
        ],
  );
  let table = $derived(tables.find((x) => x.id === tab.view?.table)?.id ?? tables[0].id);

  const openDoc = (r: DocRow, keep: boolean) => app.openFile(r.provider, r.path, { pin: keep });
  const openAnno = (a: Annotation) => app.openFile(a.provider, a.file, { annoId: a.id });
</script>

<div class="pane">
  <div class="main">
    <header>
      {#if project}
        <span class="sign plate">{project.details.number || "–"}</span>
        <div class="head-main">
          <h1>{project.details.title}</h1>
          <p class="facts">
            {#if project.details.branch}<span>{project.details.branch}</span>{/if}
            {#if project.details.road}<span>{project.details.road}</span>{/if}
            <span>{t(project.details.status)}</span>
            <span>{t("{n} documents", { n: docs.length })}, {formatSize(project.size)}</span>
          </p>
        </div>
      {:else}
        <div class="head-main">
          <h1>{provider?.name ?? tab.title}</h1>
          <p class="facts">
            <span>{t("{n} projects", { n: projects.length })}</span>
            <span>{t("{n} documents", { n: provider?.projects.reduce((s, p) => s + p.files, 0) ?? 0 })}</span>
            <span class="ellipsis">{provider?.root}</span>
          </p>
        </div>
      {/if}
      {#if !app.panelOpen}
        <button class="btn" onclick={() => app.togglePanel(true)}><Icon name="panel" size={14} /> {t("Details")}</button>
      {/if}
    </header>

    <div class="levels" role="tablist">
      {#each tables as x (x.id)}
        <button role="tab" aria-selected={table === x.id} class={{ on: table === x.id }} onclick={() => (tab.view = { ...tab.view, table: x.id })}>
          {x.label} <span>{x.n}</span>
        </button>
      {/each}
    </div>

    {#if provider?.error}
      <p class="err">{provider.error}</p>
    {:else if table === "projects" && provider}
      <DataTable
        kind="projects"
        columns={projectColumns(provider)}
        rows={projects}
        rowKey={(r: ProjectRow) => r.folder}
        builtins={projectViews()}
        empty={app.loading ? t("Loading projects…") : t("This provider folder has no project folders yet.")}
        onOpen={(r: ProjectRow) => app.openProject(r.provider, r.folder, true)}
        onMenu={(e: MouseEvent, r: ProjectRow) => app.showMenu(e, projectMenu(r.provider, r.folder))}
      />
    {:else if table === "documents"}
      <DataTable
        kind="documents"
        columns={documentColumns(docs)}
        rows={docs}
        rowKey={(r: DocRow) => r.path}
        builtins={documentViews()}
        empty={app.loading ? t("Loading documents…") : t("There are no documents here.")}
        onOpen={openDoc}
        onMenu={(e: MouseEvent, r: DocRow) => app.showMenu(e, fileMenu(r.provider, r.path))}
      />
    {:else}
      <DataTable
        kind="annotations-all"
        columns={annotationColumns(true)}
        rows={annos}
        rowKey={(a: Annotation) => a.id}
        builtins={annotationViews(true)}
        empty={t("Nothing annotated yet. Open a document and select text, draw an area or add a note. Everything you mark is collected here.")}
        onOpen={openAnno}
      />
    {/if}
  </div>
  {#if app.panelOpen}<InfoPanel {tab} />{/if}
</div>

<style>
  .pane {
    display: flex;
    height: 100%;
    background: var(--surface);
    container: pane / inline-size;
  }
  @container pane (max-width: 680px) {
    .pane {
      flex-direction: column;
    }
  }
  .main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 18px 16px 12px;
    flex: none;
  }
  /* The project number as a small motorway sign. */
  .sign {
    flex: none;
    margin-top: 2px;
    padding: 6px 10px 4px;
    background: #1d54b4;
    color: #fff;
    border-radius: 6px;
    box-shadow: inset 0 0 0 2px #fff, 0 0 0 1px #1d54b4;
    font-size: 17px;
  }
  .head-main {
    flex: 1;
    min-width: 0;
  }
  h1 {
    font-size: 21px;
    font-weight: 650;
    letter-spacing: -0.015em;
    line-height: 1.25;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    margin: 3px 0 0;
    color: var(--text-2);
    min-width: 0;
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
  .levels {
    display: flex;
    gap: 6px;
    padding: 0 16px 10px;
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
    font-variant-numeric: tabular-nums;
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
  .err {
    margin: 16px;
    color: var(--danger);
  }
</style>
