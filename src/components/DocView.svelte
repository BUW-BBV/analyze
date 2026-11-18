<script lang="ts">
  import { api, fileUrl, flatFiles, kindOf, type Annotation } from "../lib/api";
  import { annotationColumns, annotationViews } from "../lib/columns";
  import { t } from "../lib/i18n.svelte";
  import { qia } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import { ws, type Tab } from "../lib/workspace.svelte";
  import DataTable from "./DataTable.svelte";
  import Icon from "./Icon.svelte";
  import InfoPanel from "./InfoPanel.svelte";
  import PdfViewer from "./PdfViewer.svelte";
  import PlainView from "./PlainView.svelte";
  import SheetViewer from "./SheetViewer.svelte";
  import TagEditor from "./TagEditor.svelte";

  let { tab, active }: { tab: Tab; active: boolean } = $props();

  let kind = $derived(kindOf(tab.title));
  let annos = $derived(app.annotations.filter((a) => a.provider === tab.provider && a.file === tab.path));
  let mode = $derived(tab.view?.mode ?? "document");
  let notice = $state("");
  // Viewers are created the first time their tab is shown, so restored background tabs cost nothing.
  let shown = $state(false);
  $effect(() => {
    if (active) shown = true;
  });

  const inArchive = $derived(/\.zip\//i.test(tab.path));
  let project = $derived(app.project(tab.provider, tab.project));
  let folder = $derived(
    tab.path
      .slice(tab.project ? tab.project.length + 1 : 0)
      .split("/")
      .slice(0, -1)
      .join(" / "),
  );
  let size = $derived(flatFiles(app.trees[tab.provider] ?? []).find((f) => f.path === tab.path)?.size);

  const setMode = (m: "document" | "overview") => (tab.view = { ...tab.view, mode: m });

  function create(partial: Partial<Annotation>) {
    ws.pin(tab.id);
    app
      .addAnnotation({ provider: tab.provider, project: tab.project, file: tab.path, color: "yellow", analysis: qia.activeId, ...partial })
      .catch((e) => (notice = t("The annotation was not saved: {error}", { error: e.message })));
  }

  function reveal(a: Annotation) {
    setMode("document");
    app.focusedAnno = a.id;
    tab.jump = { annoId: a.id, n: Date.now() };
  }

  function openExternally(revealInFolder: boolean) {
    api.open(tab.provider, tab.path, revealInFolder).catch((e) => (notice = e.message));
  }
</script>

{#snippet actions()}
  {#if app.local && !inArchive}
    <button class="icon-btn" title={t("Open in default app")} onclick={() => openExternally(false)}><Icon name="external" /></button>
    <button class="icon-btn" title={t("Show in Explorer")} onclick={() => openExternally(true)}><Icon name="reveal" /></button>
  {/if}
  <a class="icon-btn" title={t("Download")} href={fileUrl(tab.provider, tab.path, true)}><Icon name="download" /></a>
  <button class={["icon-btn", "panel-btn", { on: app.panelOpen }]} title={app.panelOpen ? t("Hide details and annotations") : t("Show details and annotations")} onclick={() => app.togglePanel()}>
    <Icon name="panel" />
    {#if annos.length && !app.panelOpen}<span class="badge">{annos.length}</span>{/if}
  </button>
{/snippet}

<div class="doc">
  {#if notice}
    <div class="notice" role="alert">
      {notice}
      <button class="icon-btn" aria-label={t("Dismiss")} onclick={() => (notice = "")}><Icon name="close" size={12} /></button>
    </div>
  {/if}
  <div class="filebar">
    <div class="modes" role="tablist">
      <button role="tab" aria-selected={mode === "document"} class={{ on: mode === "document" }} onclick={() => setMode("document")}>{t("Document")}</button>
      <button role="tab" aria-selected={mode === "overview"} class={{ on: mode === "overview" }} onclick={() => setMode("overview")}>
        {t("Overview")}{#if annos.length}<span>{annos.length}</span>{/if}
      </button>
    </div>
    {#if project}
      <button class="plate" title={project.title} onclick={() => app.openProject(tab.provider, tab.project, true)}>{project.number || project.title}</button>
    {/if}
    {#if folder}<span class="folder ellipsis" title={folder}>{folder}</span>{/if}
    <span class="tagwrap"><TagEditor provider={tab.provider} path={tab.path} /></span>
  </div>

  <div class="pane">
    <!-- The viewer stays alive while the overview is showing, so page and zoom are kept. -->
    <div class={["view", { off: mode !== "document" }]}>
      {#if !shown}
        <div></div>
      {:else if kind === "pdf"}
        <PdfViewer {tab} {annos} {actions} onCreate={create} />
      {:else if kind === "sheet"}
        <SheetViewer {tab} {annos} {actions} onCreate={create} />
      {:else}
        <PlainView {tab} {kind} {actions} />
      {/if}
    </div>
    {#if mode === "overview"}
      <div class="view over">
        <div class="toolbar">
          <span class="title ellipsis">{t("Annotations in this document")}</span>
          <span class="grow"></span>
          <button class="btn" onclick={() => create({ kind: "doc" })}><Icon name="plus" size={13} /> {t("Note")}</button>
          {@render actions()}
        </div>
        <DataTable
          kind="annotations"
          columns={annotationColumns(false)}
          rows={annos}
          rowKey={(a: Annotation) => a.id}
          builtins={annotationViews(false)}
          empty={t("Nothing annotated in this document yet. Switch to “Document”, then select text, draw an area or place a note.")}
          isActive={(a: Annotation) => app.focusedAnno === a.id}
          onOpen={reveal}
        />
      </div>
    {/if}
    {#if app.panelOpen && shown}
      <InfoPanel {tab} {annos} {size} onReveal={reveal} onAddNote={() => create({ kind: "doc" })} />
    {/if}
  </div>
</div>

<style>
  .doc {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
  }
  .filebar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 3px 10px 3px 6px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    flex: none;
    min-width: 0;
  }
  .modes {
    display: flex;
    padding: 2px;
    border-radius: 7px;
    background: var(--surface-3);
    flex: none;
  }
  .modes button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .modes button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
  .modes span {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--yellow);
    color: #1b2026;
    font-size: 10.5px;
    line-height: 15px;
  }
  .filebar .plate {
    color: var(--accent-text);
    flex: none;
  }
  .filebar .plate:hover {
    text-decoration: underline;
  }
  .folder {
    color: var(--text-3);
    font-size: 12px;
    flex: 0 1 auto;
    min-width: 0;
  }
  .tagwrap {
    flex: 1 1 200px;
    min-width: 0;
    padding-left: 10px;
    border-left: 1px solid var(--border-strong);
  }
  .pane {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
    container: pane / inline-size;
  }
  @container pane (max-width: 680px) {
    .pane {
      flex-direction: column;
    }
  }
  .view {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .view > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .view > :global(.toolbar) {
    flex: none;
  }
  .view.off {
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .title {
    font-weight: 650;
    color: var(--text);
    padding-left: 6px;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 6px 4px 12px;
    background: var(--danger-soft);
    color: var(--danger);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .panel-btn {
    position: relative;
  }
  .badge {
    position: absolute;
    top: -3px;
    right: -5px;
    min-width: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--yellow);
    color: #1b2026;
    font-size: 10px;
    font-weight: 600;
    line-height: 15px;
  }
</style>
