<script lang="ts">
  import type { Snippet } from "svelte";
  import { api, extOf, fileUrl, type FileKind } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { app } from "../lib/state.svelte";
  import type { Tab } from "../lib/workspace.svelte";

  let { tab, kind, actions }: { tab: Tab; kind: FileKind; actions: Snippet } = $props();

  // A tab never changes its file, so reading it once is intended.
  // svelte-ignore state_referenced_locally
  const url = fileUrl(tab.provider, tab.path);
  // svelte-ignore state_referenced_locally
  const inArchive = /\.zip\//i.test(tab.path);
  const MAX_TEXT = 2_000_000;

  let text = $state.raw<string | null>(null);
  let truncated = $state(false);
  let error = $state("");
  let actualSize = $state(false);

  // svelte-ignore state_referenced_locally
  if (kind === "text") {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((buf) => {
        const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
        const declared = head.match(/encoding=["']([\w-]+)["']/i)?.[1];
        let decoded: string;
        try {
          decoded = new TextDecoder(declared ?? "utf-8", { fatal: !declared }).decode(buf);
        } catch {
          decoded = new TextDecoder("windows-1252").decode(buf);
        }
        truncated = decoded.length > MAX_TEXT;
        text = decoded.slice(0, MAX_TEXT);
      })
      .catch((e) => (error = e.message));
  }

  function renderDocx(el: HTMLElement) {
    let gone = false;
    let fontStyle: HTMLStyleElement | undefined;
    Promise.all([import("docx-preview"), fetch(url).then((r) => r.blob())])
      .then(async ([lib, blob]) => {
        if (gone) return;
        const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
        const styles = document.createElement("div");
        const body = document.createElement("div");
        root.replaceChildren(styles, body);
        await lib.renderAsync(blob, body, styles, { inWrapper: true, breakPages: true, experimental: true, ignoreLastRenderedPageBreak: false });
        // Embedded fonts only load from document-level @font-face rules.
        const faces = [...styles.querySelectorAll("style")].flatMap((st) => st.textContent?.match(/@font-face\s*{[^}]*}/g) ?? []);
        if (faces.length) {
          fontStyle = document.createElement("style");
          fontStyle.textContent = faces.join("\n");
          document.head.append(fontStyle);
        }
        const extra = document.createElement("style");
        extra.textContent = ".docx-wrapper{background:transparent!important;padding:16px!important}.docx-wrapper>section.docx{box-shadow:0 1px 4px rgb(0 0 0/.25)!important;margin-bottom:12px!important;color:#000}";
        root.append(extra);
      })
      .catch((e) => (error = e?.message ?? "The document could not be rendered"));
    return () => {
      gone = true;
      fontStyle?.remove();
    };
  }
</script>

<div class="viewer">
  <div class="toolbar">
    {#if kind === "image"}
      <button class="btn" onclick={() => (actualSize = !actualSize)}>{actualSize ? t("Fit to window") : t("Show actual size")}</button>
    {/if}
    <span class="grow"></span>
    {@render actions()}
  </div>
  <div class={["body", kind]}>
    {#if error}
      <p class="msg err">{t("This file could not be shown: {error}", { error })}</p>
    {:else if kind === "image"}
      <img src={url} alt={tab.title} class={{ fit: !actualSize }} />
    {:else if kind === "text"}
      {#if text === null}
        <p class="msg">{t("Loading…")}</p>
      {:else}
        {#if truncated}<p class="msg">{t("Showing the first 2 MB of this file.")}</p>{/if}
        <pre>{text}</pre>
      {/if}
    {:else if kind === "docx"}
      <div class="docx" {@attach renderDocx}></div>
    {:else}
      <div class="card">
        <p class="type">.{extOf(tab.title) || "file"}</p>
        <p>{t("There is no built-in preview for this file type. You can still tag it and add notes in the annotations panel.")}</p>
        <div class="row">
          {#if app.local && !inArchive}
            <button class="btn primary" onclick={() => api.open(tab.provider, tab.path).catch((e) => (error = e.message))}>{t("Open in default app")}</button>
          {/if}
          <a class="btn" href={fileUrl(tab.provider, tab.path, true)}>{t("Download")}</a>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }
  .body.image,
  .body.docx {
    background: var(--canvas);
  }
  .body.image {
    display: grid;
    place-items: center;
    padding: 16px;
  }
  img {
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
    background: #fff;
  }
  img.fit {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  pre {
    margin: 0;
    padding: 14px 18px;
    font: 12.5px/1.5 Consolas, "Cascadia Mono", monospace;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }
  .docx :global(.docx-wrapper) {
    background: transparent;
    padding: 16px;
  }
  .msg {
    margin: 12px 18px;
    color: var(--ink-2);
  }
  .err {
    color: var(--danger);
  }
  .card {
    max-width: 400px;
    margin: 12vh auto;
    padding: 0 24px;
  }
  .type {
    font-size: 40px;
    font-weight: 700;
    font-stretch: 85%;
    margin: 0;
    color: var(--ink-3);
  }
  .row {
    display: flex;
    gap: 8px;
  }
</style>
