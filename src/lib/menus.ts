import { api, fileUrl, STATUSES } from "./api";
import { t } from "./i18n.svelte";
import { app, type MenuItem } from "./state.svelte";

const inArchive = (path: string) => /\.zip\//i.test(path);

export function fileMenu(provider: string, path: string): MenuItem[] {
  const items: MenuItem[] = [
    { label: t("Open"), action: () => app.openFile(provider, path, { pin: true }) },
    { label: t("Open to the side"), action: () => app.openFile(provider, path, { side: true }) },
  ];
  if (app.local && !inArchive(path)) {
    items.push(
      { label: t("Open in default app"), action: () => void api.open(provider, path).catch(() => {}), separator: true },
      { label: t("Show in Explorer"), action: () => void api.open(provider, path, true).catch(() => {}) },
    );
  }
  items.push({ label: t("Edit tags…"), action: () => void (app.tagTarget = { provider, path }), separator: true });
  items.push(
    { label: t("Download"), action: () => void (location.href = fileUrl(provider, path, true)), separator: inArchive(path) },
    { label: t("Copy name"), action: () => void navigator.clipboard?.writeText(path.split("/").pop() ?? path) },
  );
  return items;
}

/** Right-click menu of a project: overview, status, folder. */
export function projectMenu(provider: string, folder: string): MenuItem[] {
  const project = app.project(provider, folder);
  if (!project) return [];
  return [
    { label: t("Open overview"), action: () => app.openProject(provider, folder, true) },
    ...STATUSES.map((s, i) => ({
      label: `${project.details.status === s ? "✓ " : "  "}${t("Status")}: ${t(s)}`,
      action: () => void app.saveProject(provider, folder, { ...project.details, status: s }),
      separator: i === 0,
    })),
    ...(app.local ? [{ label: t("Open folder in Explorer"), action: () => void api.open(provider, folder).catch(() => {}), separator: true }] : []),
    { label: t("Copy project number"), action: () => void navigator.clipboard?.writeText(project.details.number), separator: !app.local },
  ];
}
