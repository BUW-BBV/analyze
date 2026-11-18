# Analyzer

Local workbench for reading and annotating project documents from data providers.
Bun server plus a Svelte 5 client.

## Run

```
bun install
bun run start     # builds the client and serves everything on http://localhost:3210
bun run dev       # development: http://localhost:5173 with hot reload (API on 3210)
```

The server only listens on 127.0.0.1.

## Data providers

`providers.json` lists the providers (created on first start, not part of the repository; see `providers.example.json`). Each one points at a folder; every subfolder
is a project, and files directly in the folder are shown as provider files.
Add a provider with the plus button in the sidebar or by editing the file:

```json
[{ "id": "example", "name": "Example provider", "root": "../documents" }]
```

If a provider folder contains an Excel list with a "Projektnummer" column, matching
rows are shown on the project page and used to prefill the details.

## Where things are stored

- `data/analyzer.db` (SQLite): project details and annotations. Back this file up.
- Browser local storage: tab layout and panel sizes.
- The provider folders are only read, never written.

## Layout

- `server/index.ts`: HTTP API, database, spreadsheet parsing
- `server/files.ts`: file tree and transparent access into (nested) zip archives
- `src/lib/workspace.svelte.ts`: tab groups and splits
- `src/components/`: sidebar, project page, PDF / spreadsheet / other viewers, annotation panel

## Using it

- Click a project in the sidebar to open its page; the arrow next to it shows its files. Zip archives open like folders.
- A single click on a file opens a preview tab (italic title) that the next file replaces. Double-click the file or the tab to keep it open; annotating also keeps it.
- `Ctrl K` searches projects, files (including files inside zips) and annotations. `Ctrl Enter` opens a file to the side.
- Drag a tab to the edge of a tab group to split the view. Right-click tabs and files for more actions.
- `Alt W` closes the active tab, `Alt ←` / `Alt →` switches tabs.
- Tag a file in the bar above the document, from the tags column on the project page, or via right-click. Tags filter the documents table and are searchable with `Ctrl K`.
- The top bar holds search, language (EN / DE), theme and the navigation pin. Unpinned (`Ctrl B`), the navigation opens when you hover the left rail.

## Translations

UI text is wrapped in `t("English text")` (`src/lib/i18n.svelte.ts`); other languages are in `src/lib/dict.ts`.
`bun scripts/i18n-check.ts` lists strings that have no translation yet.

## Levels, scopes and tables

- Provider, project and document each have an overview. Provider → table of projects, project → table of documents, document → table of its annotations ("Overview" switch above the document).
- Tabs are kept per provider and per project. Clicking a provider or project swaps the workspace to its own tabs; the top bar shows where you are.
- Every table has the same controls: Columns, Group (nested, any column), Filter (a field under each column; number columns accept `>10`, `<5`), sort by clicking a header (Shift-click adds a second sort), CSV export, and saved views. Views are shared by all tables of the same level.
- The Details tab in the side panel belongs to whatever tab is open. Fields added there show up as columns one level up (document fields in the project's documents table, project fields in the provider's projects table).
- Status and "Open folder in Explorer" are in the right-click menu of a project.

Code: `src/lib/table.ts` (filter, sort, group), `src/lib/columns.ts` (column definitions per level), `src/components/DataTable.svelte`, `Overview.svelte`, `InfoPanel.svelte`.

## Qualitative content analysis (Mayring)

- An analysis (study) is created from the selector in the top bar. Its design (material, question, technique, units of analysis, quality criteria) and its category system (definition, anchor example, coding rule per category) apply to all material alike, so they exist once, not per project or document.
- Coding happens in documents: with an analysis active, marking text in a PDF offers the categories; every marked passage has a category select in the Annotations panel, and for summarizing techniques the fields paraphrase, generalization and reduction. "New category" creates one from the passage (inductive formation).
- Each document can be flagged "In the material" and "Coding finished" for the active analysis.
- Provider and project are aggregates: the analysis tab opened inside them shows the coded segments and the category matrix for that scope, and the overview tables get columns for coded segments and coding progress.

Code: `src/lib/qia.svelte.ts`, `src/components/AnalysisView.svelte`; server tables `analyses`, `categories`, `material`, and the coding columns on `annotations`.

## Running on a server

`deploy/compose.yaml` runs the app behind a login proxy (oauth2-proxy) and Keycloak; see the comments in that file.
Setting `OIDC_ISSUER` switches the server to sign-in mode: every request must carry a valid Keycloak token of a member
of `analyzer-users` (editor), `analyzer-admins` (admin) or `analyzer-viewers` (read only). In that mode providers cannot
be added from the browser and files cannot be opened in desktop programs. Other settings: `HOST`, `PORT`, `DATA_DIR`,
`PROVIDERS_FILE`, `PUBLIC_URL`, `OIDC_AUDIENCE`.

## Releases

A release is a version tag of the form `v1.2.3` on `main`. Tagging puts nothing live: the maintainer
installs a tagged version by hand. `CLAUDE.md` has the steps and the rules for contributions.
