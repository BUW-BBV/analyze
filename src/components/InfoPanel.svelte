<script lang="ts">
  import { formatSize, STATUSES, type Annotation, type ProjectDetails } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { app } from "../lib/state.svelte";
  import type { Tab } from "../lib/workspace.svelte";
  import AnnotationPanel from "./AnnotationPanel.svelte";
  import DetailsForm, { type Field } from "./DetailsForm.svelte";
  import Icon from "./Icon.svelte";
  import TagEditor from "./TagEditor.svelte";

  // The side panel next to any tab. "Details" adapts to what the tab shows
  // (provider, project or document); documents also get "Annotations".
  let {
    tab,
    annos = [],
    size,
    onReveal,
    onAddNote,
  }: { tab: Tab; annos?: Annotation[]; size?: number; onReveal?: (a: Annotation) => void; onAddNote?: () => void } = $props();

  let isFile = $derived(tab.kind === "file");

  type Section = "details" | "annotations";
  let sections = $derived<Section[]>(isFile ? ["details", "annotations"] : ["details"]);
  let split = $derived(isFile ? app.panelSplit : "");
  let order = $derived<Section[]>(split === "annotations" ? ["annotations", "details"] : ["details", "annotations"]);
  let host = $state<HTMLElement>();
  let dragging = $state<Section | null>(null);
  let zone = $state<"top" | "bottom" | null>(null);

  function startDrag(e: DragEvent, sec: Section) {
    if (!isFile) return e.preventDefault();
    e.dataTransfer?.setData("text/plain", sec);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    // let the drag image be taken before the drop zones cover the panel
    setTimeout(() => (dragging = sec));
  }
  function endDrag() {
    dragging = zone = null;
  }
  function drop(where: "top" | "bottom") {
    if (dragging) app.setPanelSplit(where === "top" ? dragging : dragging === "details" ? "annotations" : "details");
    endDrag();
  }

  function track(e: PointerEvent, move: (ev: PointerEvent) => void) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", move);
    el.addEventListener(
      "pointerup",
      () => {
        el.removeEventListener("pointermove", move);
        app.savePanelSize();
      },
      { once: true },
    );
  }
  const dragWidth = (e: PointerEvent) =>
    track(e, (ev) => {
      if (host) app.panelWidth = Math.min(760, Math.max(260, host.getBoundingClientRect().right - ev.clientX));
    });
  const dragRatio = (e: PointerEvent) =>
    track(e, (ev) => {
      if (!host) return;
      const r = host.getBoundingClientRect();
      app.panelRatio = Math.min(0.85, Math.max(0.15, (ev.clientY - r.top) / r.height));
    });
  let section = $derived(isFile ? app.panelTab : "details");
  let project = $derived(tab.kind === "project" ? app.project(tab.provider, tab.project) : undefined);
  let provider = $derived(app.provider(tab.provider));

  const names = (lists: ({ key: string }[] | undefined)[]) => [...new Set(lists.flatMap((l) => (l ?? []).map((f) => f.key.trim())).filter(Boolean))].sort();
  let projectFieldNames = $derived(names((provider?.projects ?? []).map((p) => p.details.custom)));
  let docFieldNames = $derived(names(Object.values(app.docDetails).map((d) => d.custom)));

  let projectFields = $derived<Field[]>([
    { key: "title", label: t("Title"), type: "textarea" },
    { key: "number", label: t("Project number"), half: true },
    { key: "status", label: t("Status"), type: "select", half: true, options: STATUSES.map((s) => ({ value: s, label: t(s) })) },
    { key: "branch", label: t("Branch"), half: true },
    { key: "road", label: t("Road"), half: true, placeholder: "A 3" },
    { key: "contract", label: t("Contract number"), half: true },
    { key: "phases", label: t("Service phases"), half: true, placeholder: t("e.g. Lph 1–4") },
    { key: "summary", label: t("Summary"), type: "textarea", placeholder: t("What is being tendered, and what matters for the analysis?") },
    { key: "notes", label: t("Notes"), type: "textarea" },
  ]);
  let docFields = $derived<Field[]>([
    { key: "description", label: t("Description"), placeholder: t("What is this document?") },
    { key: "origin", label: t("Origin"), placeholder: t("Who wrote it, when, and for what purpose?") },
    { key: "formal", label: t("Formal characteristics"), placeholder: t("e.g. scanned, 64 pages, version 1.05") },
    { key: "notes", label: t("Notes"), type: "textarea" },
  ]);
  let providerFields = $derived<Field[]>([
    { key: "description", label: t("Description") },
    { key: "notes", label: t("Notes"), type: "textarea" },
  ]);
</script>

{#snippet details()}
  <div class="body">
    {#key tab.id}
      {#if tab.kind === "file"}
        <p class="what">{t("Document")}</p>
        <p class="name">{tab.title}</p>
        {#if size != null}<p class="meta muted">{formatSize(size)}</p>{/if}
        <div class="tagbox"><TagEditor provider={tab.provider} path={tab.path} /></div>
        <DetailsForm
          fields={docFields}
          value={{ description: "", origin: "", formal: "", notes: "", ...app.docExtra(tab.provider, tab.path) }}
          fieldNames={docFieldNames}
          onSave={(v) => app.saveDocExtra(tab.provider, tab.path, v)}
        />
      {:else if tab.kind === "project"}
        <p class="what">{t("Project")}</p>
        {#if project}
          {#key project.details.status}
          <DetailsForm
            fields={projectFields}
            value={project.details}
            fieldNames={projectFieldNames}
            onSave={(v) => app.saveProject(tab.provider, tab.project, v as ProjectDetails)}
          />
          {/key}
          {#if project.register}
            <h3>{t("Provider's project list")}</h3>
            <dl>
              {#each Object.entries(project.register) as [k, v] (k)}
                <dt>{k}</dt>
                <dd>{v}</dd>
              {/each}
            </dl>
          {/if}
        {/if}
      {:else}
        <p class="what">{t("Data provider")}</p>
        <p class="name">{provider?.name}</p>
        <p class="meta muted">{provider?.root}</p>
        <DetailsForm
          fields={providerFields}
          value={{ description: "", notes: "", ...app.providerDetails[tab.provider] }}
          onSave={(v) => app.saveProviderExtra(tab.provider, v)}
        />
      {/if}
    {/key}
  </div>
{/snippet}

{#snippet annotations()}
  <AnnotationPanel {annos} provider={tab.provider} path={tab.path} onReveal={(a) => onReveal?.(a)} onAddNote={() => onAddNote?.()} />
{/snippet}

{#snippet label(sec: Section)}
  {sec === "details" ? t("Details") : t("Annotations")}{#if sec === "annotations" && annos.length}<span class="n">{annos.length}</span>{/if}
{/snippet}

<aside bind:this={host} style:width="{app.panelWidth}px">
  <div class="resize" onpointerdown={dragWidth} role="separator" aria-orientation="vertical" title={t("Drag to resize")}></div>

  {#if split}
    <!-- Both sections below each other, with a divider that can be dragged. -->
    {#each order as sec, i (sec)}
      <div class="pane" style:flex="{i === 0 ? app.panelRatio : 1 - app.panelRatio} 1 0">
        <div
          class="pane-head"
          role="group"
          draggable="true"
          ondragstart={(e) => startDrag(e, sec)}
          ondragend={endDrag}
          title={t("Drag onto the other half to swap")}
        >
          <span class="ptitle">{@render label(sec)}</span>
          <span class="grow"></span>
          <button class="icon-btn" title={t("Show as tabs again")} onclick={() => app.setPanelSplit("")}><Icon name="tabs" size={14} /></button>
          {#if i === 0}
            <button class="icon-btn" title={t("Hide panel")} onclick={() => app.togglePanel(false)}><Icon name="close" size={13} /></button>
          {/if}
        </div>
        {#if sec === "details"}{@render details()}{:else}{@render annotations()}{/if}
      </div>
      {#if i === 0}
        <div class="hsplit" onpointerdown={dragRatio} role="separator" aria-orientation="horizontal" title={t("Drag to resize")}></div>
      {/if}
    {/each}
  {:else}
    <div class="tabs" role="tablist">
      {#each sections as sec (sec)}
        <button
          role="tab"
          aria-selected={section === sec}
          class={{ on: section === sec }}
          draggable={isFile}
          ondragstart={(e) => startDrag(e, sec)}
          ondragend={endDrag}
          onclick={() => (app.panelTab = sec)}
          title={isFile ? t("Drag into the panel below to show both at once") : undefined}
        >
          {@render label(sec)}
        </button>
      {/each}
      <span class="grow"></span>
      {#if isFile}
        <button class="icon-btn" title={t("Show details and annotations below each other")} onclick={() => app.setPanelSplit("details")}><Icon name="splitDown" size={14} /></button>
      {/if}
      <button class="icon-btn" title={t("Hide panel")} onclick={() => app.togglePanel(false)}><Icon name="close" size={13} /></button>
    </div>
    {#if section === "annotations"}{@render annotations()}{:else}{@render details()}{/if}
  {/if}

  {#if dragging}
    <div class="zones">
      {#each ["top", "bottom"] as const as z (z)}
        <div
          class={["zone", { on: zone === z }]}
          role="presentation"
          ondragover={(e) => {
            e.preventDefault();
            zone = z;
          }}
          ondragleave={() => zone === z && (zone = null)}
          ondrop={(e) => {
            e.preventDefault();
            drop(z);
          }}
        >
          <span>{z === "top" ? t("Show on top") : t("Show below")}</span>
        </div>
      {/each}
    </div>
  {/if}
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    position: relative;
    flex: none;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--bg);
  }
  /* In narrow tab groups the panel moves below the content. */
  @container pane (max-width: 680px) {
    aside {
      width: auto !important;
      max-height: 46%;
      border-left: none;
      border-top: 1px solid var(--border);
    }
  }
  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 6px;
    z-index: 8;
    cursor: col-resize;
    touch-action: none;
  }
  .resize:hover,
  .hsplit:hover {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .pane-head {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    flex: none;
    cursor: grab;
  }
  .ptitle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 650;
  }
  .hsplit {
    flex: none;
    height: 5px;
    margin: -2px 0;
    z-index: 3;
    cursor: row-resize;
    touch-action: none;
    border-top: 1px solid var(--border);
  }
  .zones {
    position: absolute;
    inset: 38px 0 0 0;
    z-index: 9;
    display: grid;
    grid-template-rows: 1fr 1fr;
  }
  .zone {
    display: grid;
    place-items: center;
    color: transparent;
    font-weight: 600;
  }
  .zone.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    outline: 2px solid var(--accent);
    outline-offset: -3px;
    color: var(--accent-text);
  }
  .tabs [role="tab"][draggable="true"] {
    cursor: grab;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 6px 0 8px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .tabs [role="tab"] {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 8px;
    color: var(--text-2);
    border-bottom: 2px solid transparent;
  }
  .tabs [role="tab"].on {
    color: var(--text);
    font-weight: 650;
    border-bottom-color: var(--accent);
  }
  .n {
    min-width: 17px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--surface-3);
    font-size: 11px;
    font-weight: 600;
    line-height: 17px;
    text-align: center;
  }
  .grow {
    flex: 1;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px 20px;
  }
  .what {
    margin: 0 0 2px;
    font-size: 12px;
    color: var(--text-3);
  }
  .name {
    margin: 0;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .meta {
    margin: 2px 0 0;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .what + :global(form) {
    margin-top: 8px;
  }
  .tagbox {
    margin: 10px 0 12px;
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .meta + :global(form) {
    margin-top: 12px;
  }
  h3 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    margin: 20px 0 8px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 5px 14px;
    margin: 0;
    font-size: 12.5px;
  }
  dt {
    color: var(--text-3);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
