<script lang="ts">
  import logoUrl from '../assets/birdy-logo.png'

  /** Height in px; the bird is a little wider than tall. */
  let { size = 22, glow = 1 }: { size?: number; glow?: number } = $props()
</script>

<!--
  Birdy mark: the bird silhouette lit in the live neon colour. The glow sits on the outer element
  because CSS applies filters before masks, so a filter on the masked element would be cut off.
-->
<span class="logo" style="--h: {size}px; --g: {glow}" role="img" aria-label="Birdy">
  <span class="bird" style="--mask: url({logoUrl})"></span>
</span>

<style>
  .logo {
    display: inline-block;
    flex: none;
    height: var(--h);
    aspect-ratio: 512 / 453;
    filter: drop-shadow(0 0 calc(2px * var(--g)) rgba(var(--accent-rgb), 0.95))
      drop-shadow(0 0 calc(7px * var(--g)) rgba(var(--accent-rgb), 0.55))
      drop-shadow(0 0 calc(16px * var(--g)) rgba(var(--accent-rgb), 0.25));
  }
  .bird {
    display: block;
    width: 100%;
    height: 100%;
    /* A slightly hotter core than the edge, like a lit tube. */
    background: radial-gradient(circle at 60% 40%, color-mix(in srgb, var(--accent), white 22%), var(--accent) 70%);
    -webkit-mask: var(--mask) center / contain no-repeat;
    mask: var(--mask) center / contain no-repeat;
  }
</style>
