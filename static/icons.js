/*
 * Selected Lucide SVG path data embedded locally; no CDN or runtime package required.
 * Lucide is ISC-licensed; see LUCIDE-LICENSE.txt.
 * Sources: https://lucide.dev/icons and https://github.com/lucide-icons/lucide
 */
(() => {
  const paths = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    bookOpen: '<path d="M12 7v14"/><path d="M3 18V5a2 2 0 0 1 2-2h3a4 4 0 0 1 4 4 4 4 0 0 1 4-4h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-3a4 4 0 0 0-4 2 4 4 0 0 0-4-2H5a2 2 0 0 1-2-2Z"/>',
    forkKnife: '<path d="M3 2v7"/><path d="M7 2v7"/><path d="M11 2v7"/><path d="M3 9a4 4 0 0 0 8 0"/><path d="M7 13v9"/><path d="M21 15V2c-2 0-4 1.5-4 4v6c0 1.1.9 2 2 2h2Zm0 0v7"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    cookingPot: '<path d="M2 12h20"/><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M10 12V5a2 2 0 0 1 4 0v7"/><path d="M7 5V3"/><path d="M17 5V3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    tag: '<path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59A2 2 0 0 0 3.59 11l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.59Z"/><circle cx="7.5" cy="7.5" r=".5"/>',
    refreshCw: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 17.8 6L20 12M4 12l2.2 6A7 7 0 0 0 18.4 15"/>'
  };
  window.kitchenIcon = (name, className = '') => {
    const body = paths[name] || paths.bookOpen;
    return `<svg class="icon ${className}" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  };
})();
