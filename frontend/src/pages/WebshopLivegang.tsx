import { useEffect, useState, type CSSProperties } from 'react';
import { getLivegang, zetLivegang, type Livegang, type LivegangPunt, type LivegangStatus } from '../api/client';

const PILL: Record<LivegangStatus, { tekst: string; stijl: CSSProperties }> = {
  ONTBREEKT: { tekst: 'Ontbreekt', stijl: { background: '#fee2e2', color: '#991b1b' } },
  LET_OP: { tekst: 'Let op', stijl: { background: '#fef3c7', color: '#92400e' } },
  OK: { tekst: 'In orde', stijl: { background: '#dcfce7', color: '#166534' } },
  INFO: { tekst: 'Ter info', stijl: { background: '#f1f5f9', color: '#475569' } },
};
// Eerst wat nog moet, dan wat aanbevolen is, dan wat al in orde is.
const rang = (p: LivegangPunt) =>
  p.status === 'OK' ? 4 : p.status === 'INFO' ? 3 : !p.nodig ? 2 : p.status === 'ONTBREEKT' ? 0 : 1;

// Webshop → Live zetten: wat er nog ontbreekt om de webshop echt open te zetten. De server
// kijkt het meeste zelf na; drie punten vinkt een beheerder met de hand af.
export function WebshopLivegang() {
  const [data, setData] = useState<Livegang | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  async function laad() {
    setBezig(true); setFout('');
    try { setData(await getLivegang()); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Controleren mislukt'); }
    finally { setBezig(false); }
  }
  useEffect(() => { void laad(); }, []);

  async function vink(p: LivegangPunt, bevestigd: boolean) {
    setFout('');
    try { setData(await zetLivegang(p.sleutel, bevestigd)); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }

  if (!data) return <div style={{ color: fout ? 'crimson' : '#6b7280' }}>{fout || 'Controleren… (Mollie, domein, wachtwoorden, allergenen)'}</div>;
  const punten = [...data.punten].sort((a, b) => rang(a) - rang(b));
  const aanbevolen = data.punten.filter((p) => !p.nodig && p.status !== 'OK' && p.status !== 'INFO').length;

  return (
    <div>
      <div style={{ ...banner, background: data.klaar ? '#dcfce7' : '#fef2f2', borderColor: data.klaar ? '#86efac' : '#fecaca', color: data.klaar ? '#166534' : '#991b1b' }}>
        <strong style={{ fontSize: 17 }}>
          {data.klaar ? 'Klaar om live te gaan' : `Nog ${data.open} ${data.open === 1 ? 'punt' : 'punten'} voor de webshop live kan`}
        </strong>
        <span style={{ fontSize: 13 }}>
          {data.klaar
            ? 'Alles wat nodig is, staat in orde. Zet de live-sleutel van Mollie als je dat nog niet deed.'
            : 'Hieronder eerst wat nog moet. Wat jullie zelf moeten doen, staat bij "Waar".'}
          {aanbevolen ? ` ${aanbevolen} aanbeveling${aanbevolen === 1 ? '' : 'en'}.` : ''}
        </span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <button onClick={() => void laad()} disabled={bezig} style={knop}>{bezig ? 'Bezig…' : 'Opnieuw controleren'}</button>
          <span style={{ color: '#6b7280' }}>Gecontroleerd om {new Date(data.gecontroleerdOp).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
        {punten.map((p) => (
          <li key={p.sleutel} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ ...pill, ...PILL[p.status].stijl }}>{PILL[p.status].tekst}</span>
              <strong>{p.titel}</strong>
              {!p.nodig && <span style={{ fontSize: 12, color: '#6b7280' }}>niet verplicht</span>}
            </div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{p.uitleg}</div>
            {p.details?.length ? (
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, color: '#374151' }}>
                {p.details.map((d) => <li key={d}>{d}</li>)}
              </ul>
            ) : null}
            {p.waar && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Waar: {p.waar}</div>}
            {p.handmatig && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 6 }}>
                <input type="checkbox" checked={p.handmatig.bevestigd} onChange={(e) => void vink(p, e.target.checked)} />
                {p.sleutel === 'repository' ? 'Gedaan' : 'Nagekeken'}
                {p.handmatig.bevestigd && p.handmatig.op && (
                  <span style={{ color: '#6b7280' }}>
                    ({p.handmatig.door ? `${p.handmatig.door}, ` : ''}{new Date(p.handmatig.op).toLocaleDateString('nl-BE')})
                  </span>
                )}
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const banner: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid', borderRadius: 10, padding: '12px 14px' };
const pill: CSSProperties = { borderRadius: 999, padding: '1px 9px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' };
const knop: CSSProperties = { padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151' };
