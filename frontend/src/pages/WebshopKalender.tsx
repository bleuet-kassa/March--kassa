import { useEffect, useState, type CSSProperties } from 'react';
import { getWebshopKalender, zetDagenVooraf, zetWebshopDag, type KalenderDag } from '../api/client';

const WEEKDAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const vandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const andereMaand = (maand: string, stap: number) => {
  const [j, m] = maand.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1 + stap, 1)).toISOString().slice(0, 7);
};
const maandNaam = (maand: string) => new Date(`${maand}-01T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'UTC', month: 'long', year: 'numeric' });

// Webshopkalender: per dag afhalen en leveren aan of uit. Standaard kan je afhalen op de dagen dat
// de winkel open is (openingsuren op het Website-scherm) en nergens laten leveren.
export function WebshopKalender() {
  const [maand, setMaand] = useState(vandaag().slice(0, 7));
  const [dagen, setDagen] = useState<KalenderDag[]>([]);
  const [vooraf, setVooraf] = useState('');
  const [bezig, setBezig] = useState('');
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');

  useEffect(() => {
    setFout('');
    getWebshopKalender(maand)
      .then((k) => { setDagen(k.dagen); setVooraf(String(k.dagenVooraf)); })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Kalender laden mislukt'));
  }, [maand]);

  async function wissel(d: KalenderDag, soort: 'afhalen' | 'leveren') {
    setBezig(d.iso + soort); setFout(''); setMelding('');
    try {
      const bij = await zetWebshopDag(d.iso, { [soort]: !d[soort] });
      setDagen((l) => l.map((x) => (x.iso === d.iso ? bij : x)));
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(''); }
  }

  async function bewaarVooraf() {
    setFout(''); setMelding('');
    try {
      const r = await zetDagenVooraf(Number(vooraf));
      setVooraf(String(r.dagenVooraf));
      setMelding(`Klanten bestellen nu minstens ${r.dagenVooraf} ${r.dagenVooraf === 1 ? 'dag' : 'dagen'} op voorhand.`);
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }

  const nu = vandaag();
  const legeVakjes = (new Date(`${maand}-01T12:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <div style={{ maxWidth: 900 }}>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        Klik op een dag om afhalen of leveren aan of uit te zetten. Standaard kan je afhalen op de dagen dat de winkel open is en kan er nergens geleverd worden.
        Een dikke rand betekent dat je die dag zelf aangepast hebt.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label htmlFor="vooraf" style={{ fontSize: 14 }}>Klanten bestellen minstens</label>
        <input id="vooraf" value={vooraf} onChange={(e) => setVooraf(e.target.value)} inputMode="numeric" style={{ ...inp, width: 56 }} />
        <span style={{ fontSize: 14 }}>dagen op voorhand</span>
        <button onClick={bewaarVooraf} style={btnMini}>Bewaren</button>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534' }}>{melding}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
        <button onClick={() => setMaand(andereMaand(maand, -1))} disabled={maand <= nu.slice(0, 7)} aria-label="Vorige maand" style={btnMini}>‹</button>
        <strong style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{maandNaam(maand)}</strong>
        <button onClick={() => setMaand(andereMaand(maand, 1))} aria-label="Volgende maand" style={btnMini}>›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
        {WEEKDAGEN.map((w) => <div key={w} style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', fontWeight: 600 }}>{w}</div>)}
        {Array.from({ length: legeVakjes }, (_, i) => <div key={`leeg${i}`} />)}
        {dagen.map((d) => {
          const voorbij = d.iso < nu;
          return (
            <div key={d.iso} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, background: voorbij ? '#f9fafb' : '#fff', opacity: voorbij ? 0.5 : 1, minHeight: 74 }}>
              <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                <span>{Number(d.iso.slice(8))}</span>
                {!d.winkelOpen && <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400 }}>dicht</span>}
              </div>
              <button disabled={voorbij || !!bezig} onClick={() => wissel(d, 'afhalen')} aria-pressed={d.afhalen} title={`Afhalen ${d.afhalen ? 'aan' : 'uit'}`} style={schakel(d.afhalen, d.afhalenAangepast, '#16a34a')}>
                🏬<span className="wk-label"> Afhalen</span>
              </button>
              <button disabled={voorbij || !!bezig} onClick={() => wissel(d, 'leveren')} aria-pressed={d.leveren} title={`Leveren ${d.leveren ? 'aan' : 'uit'}`} style={schakel(d.leveren, d.leverenAangepast, '#2563eb')}>
                🚚<span className="wk-label"> Leveren</span>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Gekleurd = aan, wit = uit. De openingsuren zelf pas je aan op het Website-scherm.</div>
    </div>
  );
}

function schakel(aan: boolean, aangepast: boolean, kleur: string): CSSProperties {
  return {
    display: 'block', width: '100%', marginTop: 3, padding: '3px 2px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
    border: `${aangepast ? 2 : 1}px solid ${aangepast ? '#111827' : aan ? kleur : '#d1d5db'}`,
    background: aan ? kleur : '#fff', color: aan ? '#fff' : '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden',
  };
}
const inp: CSSProperties = { padding: 6, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
