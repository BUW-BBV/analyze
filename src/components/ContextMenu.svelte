<script lang="ts">
  import { app } from "../lib/state.svelte";

  // Keep the menu inside the window and move focus into it.
  function place(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(app.menu!.x, innerWidth - r.width - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(app.menu!.y, innerHeight - r.height - 6))}px`;
    el.querySelector("button")?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (!app.menu) return;
    if (e.key === "Escape") return void (app.menu = null);
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...document.querySelectorAll<HTMLElement>(".ctx button")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
</script>

<svelte:window onkeydown={onKey} onblur={() => (app.menu = null)} />

{#if app.menu}
  <div class="veil" role="presentation" onpointerdown={() => (app.menu = null)} oncontextmenu={(e) => { e.preventDefault(); app.menu = null; }}></div>
  {#key app.menu}
    <div class="ctx" role="menu" {@attach place}>
      {#each app.menu.items as item, i (i)}
        {#if item.separator}<hr />{/if}
        <button
          role="menuitem"
          class={{ danger: item.danger }}
          onclick={() => {
            app.menu = null;
            item.action();
          }}>{item.label}</button
        >
      {/each}
    </div>
  {/key}
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 90;
  }
  .ctx {
    position: fixed;
    z-index: 91;
    min-width: 190px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  button {
    display: block;
    width: 100%;
    padding: 5px 10px;
    border-radius: 5px;
    text-align: left;
    white-space: nowrap;
  }
  button:hover,
  button:focus-visible {
    background: var(--accent-soft);
    color: var(--accent-text);
    outline: none;
  }
  .danger {
    color: var(--danger);
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>
