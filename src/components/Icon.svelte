<script lang="ts" module>
  // Stroke icons on a 24px grid. Static strings only.
  const ICONS = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M11 4v16"/>',
    merge: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>',
    subtract: '<rect x="4" y="6" width="12" height="12" rx="1"/><circle cx="17" cy="12" r="4" stroke-dasharray="2 2"/>',
    intersect: '<circle cx="9" cy="12" r="5" stroke-dasharray="2 2"/><circle cx="15" cy="12" r="5" stroke-dasharray="2 2"/><path d="M12 8a5 5 0 0 1 0 8 5 5 0 0 1 0-8z" fill="currentColor"/>',
    cut: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5l12 8M8 15.5l12-8"/>',
    simplify: '<path d="M4 18l5-10 4 6 3-4 4 8z"/>',
    smooth: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/>',
    hollow: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1" stroke-dasharray="2 2"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    shells: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="M11 13l2-2" stroke-dasharray="1 2"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    open: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    forward: '<path d="M9 6l6 6-6 6"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    select: '<path d="M6 3l13 7.5-6 1.5-2.5 6z"/>',
    move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    rotate: '<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v5h5"/>',
    scale: '<rect x="4" y="11" width="9" height="9" rx="1"/><path d="M14 4h6v6M20 4l-8 8"/>',
    fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    bbox: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/><path d="M12 8l4 2v4l-4 2-4-2v-4z"/>',
    wireframe: '<path d="M12 3L3 19h18z"/><path d="M7.5 11h9M12 3v16M7.5 11L12 19l4.5-8"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    snap: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/>',
    perspective: '<path d="M3 6l18-3v18L3 18z"/><path d="M3 12h18M12 4.5v15"/>',
    ortho: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>',
    mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7l-5 5 5 5zM15 7l5 5-5 5z"/>',
    floor: '<path d="M12 4v10M8 10l4 4 4-4M4 20h16"/>',
    settle: '<path d="M4 20h16"/><path d="M8 16l4-9 6 3-3 6z"/><path d="M5 9a6 6 0 0 1 5-5"/><path d="M10 4l0 2.5L7.6 5.2"/>',
    center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    reset: '<path d="M4 7v5h5"/><path d="M4.6 12A8 8 0 1 0 7 6.3"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    library: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16.5 4.6l3.8-1 3.7 15.5-3.8 1z" transform="translate(-2 0.5)"/>',
    shield: '<path d="M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    folderplus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    workspace: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 9l3.5 2v4L12 17l-3.5-2v-4z"/>',
    layers: '<path d="M12 4l9 4.5-9 4.5-9-4.5z"/><path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
    printer: '<path d="M4 4h16v16H4z"/><path d="M4 8h16M9 8v3h6V8M10 11l2 2 2-2M7 17h10"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    usb: '<path d="M12 3v14M9 6l3-3 3 3M7 10v2l5 3 5-3v-2"/><circle cx="12" cy="19" r="2"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 15v4h14v-4"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10" cy="7.5" r="1.2"/><circle cx="14.5" cy="7.5" r="1.2"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5l-8.8 8.8a2.1 2.1 0 0 1-3-3l8.8-8.8z" transform="translate(-1 -1)"/><path d="M15.2 4.6a4.5 4.5 0 0 1 4.2 4.2l-2.6.4-2-2z"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  } as const

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  let { name, size = 16, stroke = 1.75 }: { name: IconName; size?: number; stroke?: number } = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true">{@html ICONS[name]}</svg>
