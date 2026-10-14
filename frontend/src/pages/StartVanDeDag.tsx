import { useEffect, useState } from 'react';
import { getSpreukVanDaag, type Spreuk } from '../api/client';
import { getVerkoper } from '../auth';

// Het startscherm komt telkens op wanneer de kassapagina geopend wordt (klantwens).
export function moetStartschermTonen(): boolean {
  return true;
}
function markeerGetoond() { /* niets te onthouden: het scherm komt bij elke opening terug */ }

function groet(naam?: string | null, rol?: string | null) {
  const u = new Date().getHours();
  const dagdeel = u < 12 ? 'Goeiemorgen' : u < 18 ? 'Goeiemiddag' : 'Goeieavond';
  const persoonlijk = naam && rol && rol !== 'KASSA';
  return `${dagdeel}, ${persoonlijk ? naam : 'team Marché'}!`;
}

// Startscherm van de kassa (stijl "fris & kleurrijk"): spreuk van de dag in een
// carrousel, met de groet en de datum. "Start de dag" sluit het scherm.
export function StartVanDeDag({ onKlaar }: { onKlaar: () => void }) {
  const [lijst, setLijst] = useState<Spreuk[]>([]);
  const [i, setI] = useState(0);
  const [wissel, setWissel] = useState(0);
  const verkoper = getVerkoper();
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    getSpreukVanDaag().then((r) => setLijst(r.carrousel)).catch(() => setLijst([]));
  }, []);
  // Automatisch doorschuiven om de 6 seconden.
  useEffect(() => {
    if (lijst.length < 2 || reduce) return;
    const t = window.setInterval(() => { setI((x) => (x + 1) % lijst.length); setWissel((w) => w + 1); }, 6000);
    return () => window.clearInterval(t);
  }, [lijst.length, reduce]);

  function ga(delta: number) {
    if (!lijst.length) return;
    setI((x) => (x + delta + lijst.length) % lijst.length);
    setWissel((w) => w + 1);
  }
  function start() { markeerGetoond(); onKlaar(); }

  const s = lijst[i];
  const datum = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div onClick={start} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(17,24,39,.55)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, borderRadius: 18, overflow: 'hidden', color: '#fff', background: 'linear-gradient(135deg, #e9603a 0%, #f2a541 45%, #7cb342 100%)', boxShadow: '0 20px 60px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', minHeight: 360 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '14px 20px 0', fontSize: 13, opacity: .9 }}>
          <span>Marché · kassa</span><span>{datum}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '12px 24px', minWidth: 0 }}>
          <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 8 }}>{s?.emoji ?? '🌅'}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{groet(verkoper?.naam, verkoper?.rol)}</div>
          {s ? (
            <p key={wissel} style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 34px)', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-.01em', textShadow: '0 2px 10px rgba(0,0,0,.15)', animation: reduce ? undefined : 'spreukIn .5s ease' }}>
              {s.tekst}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Een goede dag begint met een goed humeur. De rest komt vanzelf.</p>
          )}
          {s?.auteur && <p style={{ margin: '10px 0 0', fontSize: 14, opacity: .9 }}>— {s.auteur}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, marginRight: 'auto' }}>
            {lijst.map((x, j) => <i key={x.id} style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', opacity: j === i ? 1 : .35 }} />)}
          </div>
          {lijst.length > 1 && (
            <>
              <button onClick={() => ga(-1)} aria-label="Vorige" style={pijl}>‹</button>
              <button onClick={() => ga(1)} aria-label="Volgende" style={pijl}>›</button>
            </>
          )}
          <button onClick={start} autoFocus style={{ border: 'none', borderRadius: 10, padding: '12px 22px', fontWeight: 700, fontSize: 16, cursor: 'pointer', background: '#fff', color: '#c2410c' }}>
            Start de dag
          </button>
        </div>
      </div>
      <style>{'@keyframes spreukIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }'}</style>
    </div>
  );
}

const pijl: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(255,255,255,.8)', color: '#fff', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', fontSize: 18 };
