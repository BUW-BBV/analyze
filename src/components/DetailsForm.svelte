<script lang="ts" module>
  export type Field = {
    key: string;
    label: string;
    type?: "text" | "textarea" | "select";
    options?: { value: string; label: string }[];
    placeholder?: string;
    half?: boolean; // two fields share a line
  };
</script>

<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  // Details of a provider, project or document: a few fixed fields plus free ones.
  // Free fields show up as columns in the table one level above.
  let {
    fields,
    value,
    fieldNames = [],
    onSave,
  }: {
    fields: Field[];
    value: Record<string, any>;
    fieldNames?: string[]; // names already used elsewhere, offered as suggestions
    onSave: (value: Record<string, any>) => Promise<unknown>;
  } = $props();

  const uid = $props.id();
  // The parent re-creates this form when the target changes, so one copy is enough.
  // svelte-ignore state_referenced_locally
  let draft = $state<Record<string, any>>({ ...$state.snapshot(value), custom: structuredClone($state.snapshot(value).custom ?? []) });
  let saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  function changed() {
    saveState = "saving";
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await onSave($state.snapshot(draft));
        saveState = "saved";
      } catch {
        saveState = "error";
      }
    }, 500);
  }
</script>

<form class="form" oninput={changed} onsubmit={(e) => e.preventDefault()}>
  <div class="grid">
    {#each fields as f (f.key)}
      <label class={{ half: f.half }}>
        {f.label}
        {#if f.type === "textarea"}
          <textarea rows="3" bind:value={draft[f.key]} placeholder={f.placeholder}></textarea>
        {:else if f.type === "select"}
          <select bind:value={draft[f.key]} onchange={changed}>
            {#each f.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        {:else}
          <input type="text" bind:value={draft[f.key]} placeholder={f.placeholder} />
        {/if}
      </label>
    {/each}
  </div>

  <h3>{t("More fields")}</h3>
  {#each draft.custom as field, i (field)}
    <div class="custom">
      <input type="text" list="names-{uid}" bind:value={field.key} placeholder={t("Field")} aria-label={t("Field name")} />
      <input type="text" bind:value={field.value} placeholder={t("Value")} aria-label={t("Field value")} />
      <button
        type="button"
        class="icon-btn"
        title={t("Remove field")}
        onclick={() => {
          draft.custom.splice(i, 1);
          changed();
        }}><Icon name="trash" size={14} /></button
      >
    </div>
  {/each}
  <datalist id="names-{uid}">
    {#each fieldNames as n (n)}<option value={n}></option>{/each}
  </datalist>
  <div class="foot">
    <button type="button" class="add" onclick={() => draft.custom.push({ key: "", value: "" })}><Icon name="plus" size={13} /> {t("Add a field")}</button>
    <span class="muted" aria-live="polite">
      {saveState === "saving" ? t("Saving…") : saveState === "saved" ? t("Saved") : saveState === "error" ? t("Not saved, server unreachable") : ""}
    </span>
  </div>
  <p class="hint muted">{t("Fields you add here appear as columns in the table one level up.")}</p>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  label {
    display: block;
    grid-column: 1 / -1;
    font-size: 12px;
    color: var(--text-2);
    min-width: 0;
  }
  label.half {
    grid-column: auto;
  }
  label :is(input, select, textarea) {
    margin-top: 3px;
    color: var(--text);
    font-size: 13px;
  }
  textarea {
    field-sizing: content;
    min-height: 60px;
    max-height: 300px;
  }
  h3 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    margin: 16px 0 6px;
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr 1.3fr auto;
    gap: 6px;
    margin-bottom: 6px;
    align-items: center;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-text);
    font-weight: 500;
    padding: 4px 0;
    font-size: 13px;
  }
  .add:hover {
    text-decoration: underline;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 12px;
  }
</style>
