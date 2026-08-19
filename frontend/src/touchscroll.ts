// Sleep-om-te-scrollen voor het POS-touchscreen. Veel kassaschermen sturen
// "muis"-events i.p.v. echte touch-events, waardoor de pagina niet met de vinger
// scrolt. Deze helper laat je de pagina slepen (vinger/muis omhoog/omlaag) om te
// scrollen. Echte touch-events laten we ongemoeid (die scrollen al native).
if (typeof window !== 'undefined' && !(window as any).__marcheTouchScroll) {
  (window as any).__marcheTouchScroll = true;

  let actief = false;
  let startY = 0;
  let startScroll = 0;
  let bewogen = false;
  let onderdrukKlik = false;

  const isVeld = (el: EventTarget | null) =>
    el instanceof HTMLElement && !!el.closest('input, textarea, select');

  function down(e: PointerEvent) {
    if (e.pointerType === 'touch') return; // echte touch scrolt native
    if (e.button !== 0) return;
    if (isVeld(e.target)) return; // laat tekstvelden met rust
    actief = true;
    bewogen = false;
    startY = e.clientY;
    startScroll = window.scrollY;
  }

  function move(e: PointerEvent) {
    if (!actief) return;
    const dy = e.clientY - startY;
    if (!bewogen && Math.abs(dy) < 8) return; // kleine beweging = klik, niet scrollen
    bewogen = true;
    onderdrukKlik = true;
    window.scrollTo(0, startScroll - dy);
    e.preventDefault();
  }

  function up() { actief = false; }

  // Na een sleep geen per-ongeluk-klik op een knop laten doorgaan.
  function klik(e: MouseEvent) {
    if (onderdrukKlik) {
      e.preventDefault();
      e.stopPropagation();
      onderdrukKlik = false;
    }
  }

  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, { passive: false, capture: true });
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('click', klik, true);
}

export {};
