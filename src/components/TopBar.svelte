<script lang="ts">
  import { i18n, LANGS, setLang, t } from "../lib/i18n.svelte";
  import { qia } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let scope = $derived(app.selected);

  async function pickAnalysis(value: string) {
    if (value !== "__new") return qia.setActive(value);
    const created = await qia.createAnalysis(t("New analysis"));
    app.openAnalysis(created.id);
  }
  let project = $derived(scope?.folder ? app.project(scope.provider, scope.folder) : undefined);
</script>

<header>
  <button
    class={["icon-btn", { on: app.sidebarPinned }]}
    title={app.sidebarPinned ? t("Unpin the navigation (it then opens on hover)") : t("Pin the navigation")}
    aria-pressed={app.sidebarPinned}
    onclick={() => app.toggleSidebar()}
  >
    <Icon name="sidebar" />
  </button>
  <span class="logo" aria-hidden="true"></span>
  <span class="mark">Analyzer</span>
  {#if scope}
    {@const sel = scope}
    <nav class="crumbs" aria-label={t("Current scope")}>
      <button class={{ here: !sel.folder }} onclick={() => app.openProvider(sel.provider, true)}>{app.provider(sel.provider)?.name ?? sel.provider}</button>
      {#if project}
        <span class="slash">/</span>
        <button class="here" onclick={() => app.openProject(sel.provider, sel.folder, true)} title={project.title}>
          <span class="plate">{project.number || "–"}</span>
          <span class="ellipsis">{project.title}</span>
        </button>
      {/if}
    </nav>
  {/if}

  <button class="search" onclick={() => (app.paletteOpen = true)}>
    <Icon name="search" size={14} />
    <span>{t("Search projects, files and annotations")}</span>
    <kbd>Ctrl K</kbd>
  </button>

  <div class="right">
    <div class="qia" title={t("Content analysis used for coding. New markings in documents are coded with it.")}>
      <Icon name="analysis" size={14} />
      <select aria-label={t("Analysis used for coding")} value={qia.activeId} onchange={(e) => pickAnalysis(e.currentTarget.value)}>
        <option value="">{t("No analysis")}</option>
        {#each qia.analyses as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        <option value="__new">{t("New analysis…")}</option>
      </select>
      {#if qia.active}
        <button class="open" onclick={() => app.openAnalysis(qia.activeId)}>{t("Open")}</button>
      {/if}
    </div>
    <button class="icon-btn" title={t("Reload folders from disk")} onclick={() => app.load()}><Icon name="refresh" /></button>
    <div class="seg" role="group" aria-label={t("Language")}>
      {#each LANGS as l (l.id)}
        <button class={{ on: i18n.lang === l.id }} aria-pressed={i18n.lang === l.id} title={l.name} onclick={() => setLang(l.id)}>{l.id.toUpperCase()}</button>
      {/each}
    </div>
    <button class="icon-btn" title={app.theme === "dark" ? t("Switch to light theme") : t("Switch to dark theme")} onclick={() => app.toggleTheme()}>
      <Icon name={app.theme === "dark" ? "sun" : "moon"} />
    </button>
    {#if app.me && !app.me.local}
      <span class="user" title="{app.me.email} ({t(app.me.role)})">{app.me.name}</span>
      <a class="signout" href={app.me.logoutUrl}>{t("Sign out")}</a>
    {/if}
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 10px 0 8px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  /* Two lanes on sign blue. */
  .logo {
    width: 20px;
    height: 20px;
    margin-left: 4px;
    border-radius: 5px;
    background:
      linear-gradient(90deg, transparent 30%, #fff 30% 42%, transparent 42% 58%, #fff 58% 70%, transparent 70%) center / 100% 60% no-repeat,
      #1d54b4;
  }
  .mark {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.01em;
    margin-right: 4px;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 0 1 auto;
    padding-left: 12px;
    border-left: 1px solid var(--border-strong);
    color: var(--text-2);
  }
  .crumbs button {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    height: 26px;
    padding: 0 6px;
    border-radius: 5px;
    white-space: nowrap;
  }
  .crumbs button:hover {
    background: var(--surface-3);
  }
  .crumbs .here {
    color: var(--text);
    font-weight: 600;
  }
  .crumbs .plate {
    color: var(--accent-text);
  }
  .slash {
    color: var(--text-3);
  }
  .search {
    margin: 0 auto;
    flex: 0 1 460px;
    min-width: 160px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-3);
    text-align: left;
  }
  .search span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .search:hover {
    border-color: var(--accent);
    color: var(--text-2);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .qia {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 4px 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-2);
  }
  .qia select {
    width: auto;
    max-width: 180px;
    border: none;
    box-shadow: none;
    background: transparent;
    padding: 0 2px;
    color: var(--text);
  }
  .qia .open {
    height: 20px;
    padding: 0 8px;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
    font-size: 12px;
  }
  .user {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    padding-left: 6px;
  }
  .signout {
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
  }
  .signout:hover {
    color: var(--text);
  }
  .seg {
    display: flex;
    padding: 2px;
    border-radius: 7px;
    background: var(--surface-3);
  }
  .seg button {
    height: 22px;
    padding: 0 8px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
</style>
