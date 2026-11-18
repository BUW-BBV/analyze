<script lang="ts" module>
  import { kindOf } from "../lib/api";

  const LOOK: Record<string, [icon: string, color: string]> = {
    pdf: ["doc", "#d0473a"],
    sheet: ["table", "#2f9457"],
    docx: ["doc", "#3d77d6"],
    image: ["image", "#8d62c4"],
    text: ["doc", "#7c8794"],
    other: ["file", "#7c8794"],
    zip: ["zip", "#c98a1b"],
    dir: ["folder", "#7c8794"],
  };
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  // A file-type icon plus a name that is shortened in the middle, so the end
  // (version, date, extension) stays readable in long German file names.
  let { name, type = "file", icon = true }: { name: string; type?: "file" | "zip" | "dir"; icon?: boolean } = $props();

  let look = $derived(LOOK[type === "file" ? kindOf(name) : type]);
  let cut = $derived(name.length > 24 ? name.length - 14 : name.length);
</script>

{#if icon}<span class="ic" style:color={look[1]}><Icon name={look[0]} size={15} /></span>{/if}
<span class="name" title={name}><span class="head">{name.slice(0, cut)}</span><span class="tail">{name.slice(cut)}</span></span>

<style>
  .ic {
    flex: none;
    display: grid;
  }
  .name {
    display: flex;
    min-width: 0;
    white-space: pre;
  }
  .head {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tail {
    flex: none;
  }
</style>
