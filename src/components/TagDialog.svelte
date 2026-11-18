<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { app } from "../lib/state.svelte";
  import FileName from "./FileName.svelte";
  import TagEditor from "./TagEditor.svelte";

  const close = () => (app.tagTarget = null);
</script>

<svelte:window onkeydown={(e) => app.tagTarget && e.key === "Escape" && close()} />

{#if app.tagTarget}
  {@const target = app.tagTarget}
  <div class="veil" role="presentation" onpointerdown={close}></div>
  <div class="box" role="dialog" aria-label={t("File tags")}>
    <h2>{t("File tags")}</h2>
    <p class="file"><FileName name={target.path.split("/").pop() ?? target.path} /></p>
    <div class="field"><TagEditor provider={target.provider} path={target.path} autofocus /></div>
    <p class="muted">{t("Press Enter to add a tag. Tags classify the file and can be used as filters on the project page.")}</p>
    <div class="actions"><button class="btn primary" onclick={close}>{t("Done")}</button></div>
  </div>
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(15 20 28 / 0.35);
  }
  .box {
    position: fixed;
    z-index: 81;
    top: 18vh;
    left: 50%;
    translate: -50% 0;
    width: min(460px, calc(100vw - 32px));
    padding: 18px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
  }
  h2 {
    font-size: 16px;
    margin-bottom: 8px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 12px;
    min-width: 0;
  }
  .field {
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .muted {
    margin: 10px 0 0;
    font-size: 12px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }
</style>
