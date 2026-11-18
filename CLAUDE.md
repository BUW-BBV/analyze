# Working in this repository

Analyzer is a workbench for reading, annotating and coding project documents (qualitative content
analysis after Mayring). Bun server (`server/`), Svelte 5 client (`src/`), SQLite database.
`README.md` describes the features and where the code for each lives. Read it first.

## This repository is public

The documents the tool is used on are confidential. Nothing about them belongs here.

- Never commit documents, extracts from documents, screenshots showing document content, the
  database, `data/`, `providers.json` or any `.env` file. They are in `.gitignore`; keep them there.
- Do not name real data providers, projects, partners or people, in code, comments, tests, examples,
  commit messages, issues or pull requests. Use invented examples ("Example provider", "Project A").
- Do not write down where or how the tool is hosted: no host names, addresses, server paths, account
  names or sign-in details beyond what `deploy/` already shows with placeholders. If a task seems to
  need such details, stop and ask the maintainer instead of guessing or searching for them.
- If you find something of this kind already committed, do not fix it quietly in a new commit (it
  stays in the history). Tell the maintainer.

## Commands

```
bun install
bun run dev                  # client on http://localhost:5173 with hot reload, API on 3210
bun run start                # production build, served on http://localhost:3210
bun run check                # type check (svelte-check); must pass
bun scripts/i18n-check.ts    # lists UI strings without a German translation; must list none
docker build -t analyzer .   # the image a release is built from; must build
```

For local work, copy `providers.example.json` to `providers.json` and point it at a folder of your
own test files. Without `OIDC_ISSUER` the server runs without sign-in and listens on 127.0.0.1 only.

## Rules for changes

- **Svelte 5 runes only** (`$state`, `$derived`, `$props`, `onclick`), no stores, no legacy syntax.
- **Every UI string** goes through `t("English text")` and gets its German entry in `src/lib/dict.ts`.
- **Provider folders are read-only.** The server never writes into them. Keep it that way.
- **Sign-in mode** (`server/auth.ts`, active when `OIDC_ISSUER` is set): every request is checked,
  and the roles viewer, editor and admin limit what it may do. Any new API route needs the same
  check as its neighbours. Do not add routes that skip it, and do not loosen existing checks.
- **Database changes must only add.** The live database is upgraded in place when a new version
  starts, and going back means starting an older version on the newer database. So: new tables and
  new columns with defaults are fine (see the `ALTER TABLE … ADD COLUMN` pattern in
  `server/index.ts`); never rename, drop or change the meaning of a table or column.
- **The image must be self-contained.** A release is built from the `Dockerfile` (and
  `deploy/backup/Dockerfile`) of the tagged commit and nothing else. The compose file and settings
  used in production are kept by the maintainer and are not taken from this repository, so:
  - a new environment variable, volume, port or service does not exist in production until the
    maintainer adds it. Give new settings a safe default and name them in the release notes;
  - `deploy/compose.yaml` and `deploy/.env.example` are the reference: update them in the same
    change, with placeholders, never real values.
- Keep dependencies few. Ask before adding one that is large or needs native code.

## Releasing a version

Tagging does not put anything live. The maintainer installs a tagged version by hand and can go
back to an earlier tag the same way. You have no access to the hosting and need none.

1. Work on a branch and merge to `main` (or commit to `main` for small fixes). `main` should always build.
2. Before a release, on `main`: `bun run check`, `bun scripts/i18n-check.ts` and
   `docker build -t analyzer .` all succeed, and you have tried the change in the browser.
3. Set the new version in `package.json` (semantic versioning: fix = patch, new feature = minor,
   anything the maintainer must act on = at least minor and called out), commit it.
4. Tag that commit and push the tag. The tag must have exactly the form `v1.2.3`:
   ```
   git tag v1.2.3
   git push origin main v1.2.3
   ```
5. Create a GitHub release for the tag with short notes: what changed for users, and a section
   "For the maintainer" listing new settings, volumes or database additions (or "nothing").
   The notes are public too: the rules above apply.
6. Tell the maintainer which tag to install.

Never move or delete a tag that has been pushed. If a release is wrong, fix it and tag the next
patch version.
