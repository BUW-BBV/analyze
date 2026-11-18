<script lang="ts" module>
  const PATHS: Record<string, string> = {
    chevron: "M6 4l4 4-4 4",
    folder: "M1.5 4.5v8h13v-7h-6l-1.5-2h-5.5z",
    file: "M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5",
    doc: "M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5 M6 8.5h4.5 M6 11h4.5",
    zip: "M1.5 4.5v8h13v-7h-6l-1.5-2h-5.5z M10.5 7.5v1 M10.5 9.8v1",
    image: "M2 3h12v10H2z M2 10.5l3.5-3 3 2.5 2-1.5 3.5 3 M10.5 6.2h.01",
    close: "M4 4l8 8 M12 4l-8 8",
    plus: "M8 3v10 M3 8h10",
    minus: "M3 8h10",
    search: "M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10z M10.7 10.7l3.8 3.8",
    download: "M8 2v8 M4.5 7L8 10.5 11.5 7 M2.5 13.5h11",
    external: "M9 2.5h4.5v4.5 M13.5 2.5l-6 6 M11.5 9.5v4h-9v-9h4",
    reveal: "M1.5 4.5v8h13v-7h-6l-1.5-2h-5.5z M6 9h4 M8.5 7.5L10 9l-1.5 1.5",
    trash: "M3 4.5h10 M6 4.5v-2h4v2 M4.5 4.5l.5 9h6l.5-9",
    text: "M3.5 12.5L8 3l4.5 9.5 M5.3 9h5.4",
    marker: "M3 13h10 M5.5 10.5l-1-1L10 4l2 2-5.5 5.5z",
    area: "M2.5 5V2.5H5 M11 2.5h2.5V5 M13.5 11v2.5H11 M5 13.5H2.5V11",
    note: "M2.5 2.5h11v8h-6l-3 3v-3h-2z",
    panel: "M1.5 2.5h13v11h-13z M10 2.5v11",
    fit: "M2 8h12 M4.5 5.5L2 8l2.5 2.5 M11.5 5.5L14 8l-2.5 2.5",
    splitRight: "M1.5 2.5h13v11h-13z M8 2.5v11",
    splitDown: "M1.5 2.5h13v11h-13z M1.5 8h13",
    refresh: "M13 8a5 5 0 1 1-1.5-3.5 M13 2.5v3h-3",
    home: "M2 8l6-5.5L14 8 M4 7v6.5h8V7",
    table: "M1.5 2.5h13v11h-13z M1.5 6h13 M1.5 9.75h13 M6 2.5v11",
    sun: "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M8 1.5v1.5 M8 13v1.5 M1.5 8H3 M13 8h1.5 M3.4 3.4l1 1 M11.6 11.6l1 1 M3.4 12.6l1-1 M11.6 4.4l1-1",
    moon: "M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.500 6.5z",
    tag: "M2 2.500h5.500l6.500 6.500-5.500 5.500L2 8z M5 5.500h.01",
    sidebar: "M1.500 2.500h13v11h-13z M5.500 2.500v11",
    columns: "M1.500 2.500h13v11h-13z M6 2.500v11 M10 2.500v11",
    group: "M2 3.500h12 M5 8h9 M8 12.500h6",
    filter: "M2 3h12l-4.500 5.500v4.500l-3-1.500v-3z",
    up: "M8 13V3 M4 7l4-4 4 4",
    analysis: "M2.500 13.500v-11 M2.500 13.500h11 M5.500 11V8 M8.500 11V5 M11.500 11V7",
    tabs: "M1.500 5.500h13v8h-13z M1.500 5.500v-3h4.500v3 M6 2.500h4v3",
    sort: "M5 3v10 M2.5 10.5L5 13l2.500-2.500 M11 13V3 M8.500 5.500L11 3l2.500 2.500",
  };
</script>

<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={PATHS[name] ?? ""} />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
