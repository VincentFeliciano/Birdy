<script lang="ts">
  let { size = 22 }: { size?: number } = $props()
</script>

<!-- Birdy mark: a neon-outline chick sitting on a print-bed line. Uses the live accent colour. -->
<svg class="logo" width={size} height={size} viewBox="0 0 24 24" aria-label="Birdy" role="img">
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke-width="1.2" />
    <circle cx="11.2" cy="12.6" r="5.6" stroke-width="1.6" />
    <path d="M16.7 11.3l2.9 1.3-2.9 1.3" stroke-width="1.6" />
    <path d="M8.2 13.4c1 1.8 2.9 2.4 4.8 1.5" stroke-width="1.4" />
    <path d="M10.6 7.1c.2-1.2 1-2 2.1-2.2" stroke-width="1.4" />
    <path d="M7.5 19.6h8" stroke-width="1.4" />
  </g>
  <circle cx="13.4" cy="11" r="1.1" fill="currentColor" />
</svg>

<style>
  .logo {
    color: var(--accent);
    filter: drop-shadow(0 0 3px rgba(var(--accent-rgb), 0.9)) drop-shadow(0 0 8px rgba(var(--accent-rgb), 0.4));
    flex: none;
  }
</style>
