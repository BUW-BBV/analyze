<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { app } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  // Tags of one file: chips plus an input with suggestions from tags already in use.
  let { provider, path, autofocus = false }: { provider: string; path: string; autofocus?: boolean } = $props();

  const uid = $props.id();
  let draft = $state("");
  let tags = $derived(app.tagsOf(provider, path));
  let suggestions = $derived(app.allTags.filter((s) => !tags.includes(s)));

  function add() {
    const fresh = draft.split(",").map((s) => s.trim()).filter(Boolean);
    draft = "";
    if (fresh.length) void app.setTags(provider, path, [...tags, ...fresh]);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && tags.length) {
      void app.setTags(provider, path, tags.slice(0, -1));
    }
  }

  const focusIf = (el: HTMLInputElement) => {
    if (autofocus) el.focus();
  };
</script>

<div class="tags">
  <Icon name="tag" size={13} />
  {#each tags as tag (tag)}
    <span class="tag">
      {tag}
      <button aria-label={t("Remove tag {tag}", { tag })} onclick={() => app.setTags(provider, path, tags.filter((x) => x !== tag))}><Icon name="close" size={10} /></button>
    </span>
  {/each}
  <input
    type="text"
    list="tags-{uid}"
    placeholder={tags.length ? t("Add tag") : t("Tag this file, e.g. AIA")}
    aria-label={t("Add tag")}
    bind:value={draft}
    onkeydown={onKey}
    onchange={add}
    {@attach focusIf}
  />
  <datalist id="tags-{uid}">
    {#each suggestions as s (s)}<option value={s}></option>{/each}
  </datalist>
</div>

<style>
  .tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    color: var(--text-3);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 20px;
    padding: 0 3px 0 8px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .tag button {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    opacity: 0.6;
  }
  .tag button:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  input {
    flex: 1;
    width: auto;
    min-width: 110px;
    height: 22px;
    padding: 0 4px;
    border: none;
    border-radius: 4px;
    background: transparent;
    font-size: 12.5px;
    color: var(--text);
  }
  input:focus {
    box-shadow: none;
    background: var(--surface-2);
  }
</style>
