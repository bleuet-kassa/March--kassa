import { useEffect, useState, type CSSProperties } from 'react';
import { getBestellingen, updateBestellingStatus, type WebshopOrder } from '../api/client';

const STATUSSEN = ['NIEUW', 'IN_BEHANDELING', 'KLAAR', 'AFGEHAALD', 'GELEVERD', 'GEANNULEERD'];
const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);
const kleur: Record<string, string> = {
  NIEUW: '#b45309', IN_BEHANDELING: '#2563eb', KLAAR: '#16a34a', AFGEHAALD: '#6b7280', GELEVERD: '#6b7280', GEANNULEERD: '#b91c1c',
};

// Beheer van webshop-bestellingen: bekijken en de status opvolgen.
export function Bestellingen() {
  const [lijst, setLijst] = useState<WebshopOrder[]>([]);
  const [filter, setFilter] = useState('');

  async function laad() { setLijst(await getBestellingen()); }
  useEffect(() => { laad(); }, []);

  async function zetStatus(id: string, status: string) {
    await updateBestellingStatus(id, status);
    setLijst((l) => l.map((o) => (o.id === id ? { ...o, status } : o)));
  }

  const zichtbaar = filter ? lijst.filter((o) => (o.status ?? 'NIEUW') === filter) : lijst;
  const nieuw = lijst.filter((o) => (o.status ?? 'NIEUW') === 'NIEUW').length;

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Bestellingen</h2>
        {nieuw > 0 && <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 10px', borderRadius: 999, fontWeight: 600, fontSize: 13 }}>{nieuw} nieuw</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        <button onClick={() => setFilter('')} style={chip(filter === '')}>Alle</button>
        {STATUSSEN.map((s) => <button key={s} onClick={() => setFilter(s)} style={chip(filter === s)}>{s.replace('_', ' ').toLowerCase()}</button>)}
      </div>

      {zichtbaar.length === 0 && <p style={{ color: '#999' }}>Geen bestellingen.</p>}

      {zichtbaar.map((o) => (
        <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>{o.klant?.naam ?? 'Onbekende klant'}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {o.klant?.email ?? ''} · {new Date(o.datum).toLocaleString('nl-BE')}
              </div>
            </div>
            <span style={{ padding: '4px 10px', borderRadius: 8, background: '#f3f4f6', fontSize: 13 }}>
              {o.leverwijze === 'LEVEREN' ? '🚚 Leveren' : '🏬 Afhalen'}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: o.betaald ? '#dcfce7' : '#fef3c7', color: o.betaald ? '#166534' : '#b45309' }}>
              {o.betaald ? '✓ Betaald' : 'Nog te betalen'}
            </span>
            <strong>{euro(o.totaal)}</strong>
            <select value={o.status ?? 'NIEUW'} onChange={(e) => zetStatus(o.id, e.target.value)}
              style={{ ...inp, marginBottom: 0, fontWeight: 600, color: kleur[o.status ?? 'NIEUW'] ?? '#111' }}>
              {STATUSSEN.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          {o.leverwijze === 'LEVEREN' && o.klant?.adres && (
            <div style={{ fontSize: 13, color: '#374151', marginTop: 8 }}>📍 {o.klant.adres}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 14, color: '#374151' }}>
            {o.lijnen.map((l, i) => (
              <span key={i}>{Number(l.aantal)}× {l.product.naam}{i < o.lijnen.length - 1 ? ' · ' : ''}</span>
            ))}
          </div>
          {o.kortingReden && <div style={{ fontSize: 13, color: '#0d4589', marginTop: 6 }}>Korting: {o.kortingReden}</div>}
        </div>
      ))}
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
function chip(actief: boolean): CSSProperties {
  return { padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13, border: actief ? '2px solid #0d4589' : '1px solid #cbd5e1', background: actief ? '#eff6ff' : '#fff', fontWeight: actief ? 600 : 400 };
}
