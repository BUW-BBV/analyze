<script lang="ts">
  import { api, STATUS_COLOR } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { fileMenu, projectMenu } from "../lib/menus";
  import { app } from "../lib/state.svelte";
  import { ws } from "../lib/workspace.svelte";
  import FileName from "./FileName.svelte";
  import FileTree from "./FileTree.svelte";
  import Icon from "./Icon.svelte";

  let collapsed = $state<Record<string, boolean>>({});

  let dialog: HTMLDialogElement;
  let newName = $state("");
  let newRoot = $state("");
  let addError = $state("");
  let adding = $state(false);

  let fileCounts = $derived.by(() => {
    const m = new Map<string, Map<string, number>>();
    for (const a of app.annotations) {
      const per = m.get(a.provider) ?? m.set(a.provider, new Map()).get(a.provider)!;
      per.set(a.file, (per.get(a.file) ?? 0) + 1);
    }
    return m;
  });
  let projectCounts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of app.annotations) m.set(`${a.provider}|${a.project}`, (m.get(`${a.provider}|${a.project}`) ?? 0) + 1);
    return m;
  });
  const NO_COUNTS = new Map<string, number>();

  function toggleFiles(key: string) {
    app.openProjects[key] = !app.openProjects[key];
  }

  async function addProvider(e: SubmitEvent) {
    e.preventDefault();
    adding = true;
    addError = "";
    try {
      await api.addProvider(newName, newRoot);
      await app.load();
      newName = newRoot = "";
      dialog.close();
    } catch (err) {
      addError = (err as Error).message;
    } finally {
      adding = false;
    }
  }
</script>

<aside>
  <nav aria-label={t("Providers and projects")}>
    {#if app.error}
      <p class="msg err">{t("The server is not responding: {error}", { error: app.error })}</p>
    {/if}
    {#each app.providers as p (p.id)}
      <section>
        <div class="provider">
          <button class="twist-btn" onclick={() => (collapsed[p.id] = !collapsed[p.id])} aria-expanded={!collapsed[p.id]} aria-label={collapsed[p.id] ? t("Show projects of {n}", { n: p.name }) : t("Hide projects of {n}", { n: p.name })}>
            <span class={["twist", { open: !collapsed[p.id] }]}><Icon name="chevron" size={12} /></span>
          </button>
          <button class={["provider-btn", { sel: app.selected?.provider === p.id && !app.selected.folder }]} onclick={() => app.openProvider(p.id, true)} title={t("Open the overview of {n}", { n: p.name })}>
            <span class="pname">{p.name}</span>
            <span class="muted">{p.projects.length}</span>
          </button>
        </div>
        {#if !collapsed[p.id]}
          {#if p.error}<p class="msg err">{p.error}</p>{/if}
          <ul>
            {#each p.projects as pr (pr.folder)}
              {@const key = `${p.id}|${pr.folder}`}
              {@const sel = app.selected?.provider === p.id && app.selected.folder === pr.folder}
              {@const open = !!app.openProjects[key]}
              {@const n = projectCounts.get(key)}
              {@const tree = open ? app.projectTree(p.id, pr.folder) : undefined}
              <li class={{ open }}>
                <div class={["project", { sel, open }]}>
                  <button class="twist-btn" onclick={() => toggleFiles(key)} aria-label={open ? t("Hide files of {n}", { n: pr.number }) : t("Show files of {n}", { n: pr.number })} aria-expanded={open}>
                    <span class={["twist", { open }]}><Icon name="chevron" size={12} /></span>
                  </button>
                  <button class="project-btn" onclick={() => app.openProject(p.id, pr.folder)} oncontextmenu={(e) => app.showMenu(e, projectMenu(p.id, pr.folder))} title={pr.folder}>
                    <span class="line1">
                      <span class="plate">{pr.number || t("No number")}</span>
                      {#if STATUS_COLOR[pr.status]}
                        <span class="status" style:background={STATUS_COLOR[pr.status]} title={t(pr.status)}></span>
                      {/if}
                      <span class="grow"></span>
                      {#if n}<span class="count" title={t("{n} annotations", { n })}>{n}</span>{/if}
                      <span class="files muted" title={t("{n} files", { n: pr.files })}>{pr.files}</span>
                    </span>
                    <span class="ptitle">{pr.title}</span>
                  </button>
                </div>
                {#if open}
                  <div class="tree">
                    {#if !tree}
                      <p class="msg">{t("Loading files…")}</p>
                    {:else if !tree.length}
                      <p class="msg">{t("This project folder is empty.")}</p>
                    {:else}
                      <FileTree provider={p.id} nodes={tree} depth={1} counts={fileCounts.get(p.id) ?? NO_COUNTS} />
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if p.files.length}
            <div class="sub muted">{t("Provider files")}</div>
            <ul>
              {#each p.files as f (f.path)}
                <li>
                  <button
                    class={["pfile", { sel: ws.activeTab?.kind === "file" && ws.activeTab.path === f.path }]}
                    onclick={() => app.openFile(p.id, f.path)}
                    ondblclick={() => app.openFile(p.id, f.path, { pin: true })}
                    oncontextmenu={(e) => app.showMenu(e, fileMenu(p.id, f.path))}
                  >
                    <FileName name={f.name} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>
    {/each}
    {#if !app.loading && !app.providers.length && !app.error}
      <p class="msg">{t("No data providers yet.")}</p>
    {/if}
  </nav>

  {#if app.local}
  <footer>
    <button class="add" onclick={() => dialog.showModal()}><Icon name="plus" size={14} /> {t("Add data provider")}</button>
  </footer>
  {/if}
</aside>

<dialog bind:this={dialog}>
  <form onsubmit={addProvider}>
    <h2>{t("Add data provider")}</h2>
    <p class="muted">{t("Each subfolder of the provider folder becomes a project.")}</p>
    <label>{t("Name")} <input type="text" bind:value={newName} placeholder={t("e.g. Deutsche Bahn")} required /></label>
    <label>{t("Folder")} <input type="text" bind:value={newRoot} placeholder="C:\Data\Provider" required /></label>
    {#if addError}<p class="err">{addError}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={() => dialog.close()}>{t("Cancel")}</button>
      <button class="btn primary" disabled={adding}>{t("Add provider")}</button>
    </div>
  </form>
</dialog>

<style>
  aside {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    min-width: 0;
  }
  .grow {
    flex: 1;
  }
  nav {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 0 16px;
  }
  .provider {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--bg);
  }
  .provider {
    display: flex;
    align-items: stretch;
    padding: 0 6px;
  }
  .provider .twist-btn {
    padding-top: 0;
    place-items: center;
  }
  .provider-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 8px 0 0;
    border-radius: 0 var(--radius) var(--radius) 0;
    text-align: left;
    font-size: 12px;
    color: var(--text-2);
  }
  .provider-btn:hover {
    background: var(--surface-3);
  }
  .provider-btn.sel {
    background: var(--accent-soft);
  }
  .pname {
    flex: 1;
    font-weight: 650;
    color: var(--text);
    font-size: 13px;
  }
  .twist {
    width: 12px;
    display: grid;
    place-items: center;
    color: var(--text-3);
    transition: transform 100ms;
  }
  .twist.open {
    transform: rotate(90deg);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .project {
    display: flex;
    align-items: stretch;
    margin: 0 6px;
    border-radius: var(--radius);
  }
  .project.open {
    position: sticky;
    top: 30px;
    z-index: 2;
    background: var(--bg);
  }
  .project:hover {
    background: var(--surface-3);
  }
  .project.sel {
    background: var(--accent-soft);
  }
  .twist-btn {
    width: 22px;
    display: grid;
    place-items: start center;
    padding-top: 9px;
    flex: none;
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .twist-btn:hover .twist {
    color: var(--text);
  }
  .project-btn {
    flex: 1;
    min-width: 0;
    padding: 6px 8px 7px 0;
    text-align: left;
    display: grid;
    gap: 1px;
  }
  .line1 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .plate {
    font-size: 13px;
    color: var(--accent-text);
  }
  .status {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .files {
    font-size: 11.5px;
    min-width: 16px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ptitle {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.3;
  }
  .project.sel .ptitle {
    color: var(--text);
  }
  .tree {
    margin: 2px 6px 8px 16px;
    border-left: 1px solid var(--border-strong);
  }
  .tree :global(.row) {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .sub {
    padding: 10px 14px 4px 28px;
    font-size: 12px;
  }
  .pfile {
    display: flex;
    align-items: center;
    gap: 6px;
    width: calc(100% - 12px);
    height: 26px;
    margin: 0 6px;
    padding: 0 8px 0 22px;
    border-radius: var(--radius);
    text-align: left;
  }
  .pfile:hover {
    background: var(--surface-3);
  }
  .pfile.sel {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  footer {
    flex: none;
    border-top: 1px solid var(--border);
    padding: 6px;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius);
    color: var(--text-2);
  }
  .add:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .msg {
    margin: 6px 14px;
    color: var(--text-3);
    font-size: 12.5px;
  }
  .err {
    color: var(--danger);
  }
  dialog {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
    width: 420px;
    max-width: calc(100vw - 32px);
    box-shadow: var(--shadow);
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgb(15 20 28 / 0.45);
  }
  dialog h2 {
    font-size: 17px;
    margin-bottom: 4px;
  }
  dialog p {
    margin: 0 0 14px;
  }
  dialog label {
    display: block;
    margin-bottom: 10px;
    font-weight: 600;
  }
  dialog label input {
    margin-top: 4px;
    font-weight: 400;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
