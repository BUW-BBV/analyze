<script lang="ts">
  import { formatSize, type TreeNode } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { fileMenu } from "../lib/menus";
  import { app } from "../lib/state.svelte";
  import { ws } from "../lib/workspace.svelte";
  import FileName from "./FileName.svelte";
  import Icon from "./Icon.svelte";
  import Self from "./FileTree.svelte";

  let { provider, nodes, depth = 0, counts }: { provider: string; nodes: TreeNode[]; depth?: number; counts: Map<string, number> } = $props();

  const pad = (extra = 0) => `${10 + depth * 14 + extra}px`;
  const isOpen = (n: TreeNode) => app.expanded[n.path] ?? false;
  const toggle = (n: TreeNode) => (app.expanded[n.path] = !isOpen(n));

  function innerCount(n: TreeNode): number {
    let sum = 0;
    for (const c of n.children ?? []) sum += c.children ? innerCount(c) : (counts.get(c.path) ?? 0);
    return sum;
  }
</script>

<ul role="group">
  {#each nodes as n (n.path)}
    {@const container = !!n.children}
    {@const open = container && isOpen(n)}
    {@const active = ws.activeTab?.kind === "file" && ws.activeTab.path === n.path}
    {@const count = container ? (open ? 0 : innerCount(n)) : counts.get(n.path)}
    <li role="treeitem" aria-expanded={container ? open : undefined} aria-selected={active}>
      <button
        class={["row", { active }]}
        style:padding-left={pad()}
        title={container ? n.name : [n.name, formatSize(n.size), ...app.tagsOf(provider, n.path)].join("\n")}
        draggable={!container}
        ondragstart={(e) => {
          ws.dragging = app.fileTab(provider, n.path);
          e.dataTransfer?.setData("text/plain", n.name);
        }}
        ondragend={() => (ws.dragging = null)}
        onclick={() => (container ? toggle(n) : app.openFile(provider, n.path))}
        ondblclick={() => !container && app.openFile(provider, n.path, { pin: true })}
        oncontextmenu={(e) => !container && app.showMenu(e, fileMenu(provider, n.path))}
      >
        <span class={["twist", { open }]}>{#if container}<Icon name="chevron" size={12} />{/if}</span>
        <FileName name={n.name} type={n.zip ? "zip" : n.type} />
        {#if count}<span class="count" title={t("{n} annotations", { n: count })}>{count}</span>{/if}
      </button>
      {#if open}
        {#if n.children?.length}
          <Self {provider} nodes={n.children} depth={depth + 1} {counts} />
        {:else}
          <div class="hint" style:padding-left={pad(34)}>{n.zip ? t("Empty or unreadable archive") : t("Empty folder")}</div>
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 26px;
    padding-right: 10px;
    text-align: left;
    color: var(--text);
    border-radius: 0;
  }
  .row:hover {
    background: var(--surface-3);
  }
  .row.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
  .row :global(.name) {
    flex: 1;
  }
  .twist {
    width: 12px;
    flex: none;
    color: var(--text-3);
    transition: transform 100ms;
  }
  .twist.open {
    transform: rotate(90deg);
  }
  .hint {
    height: 24px;
    line-height: 24px;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
