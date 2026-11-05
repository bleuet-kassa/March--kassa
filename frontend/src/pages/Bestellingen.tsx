import { useEffect, useState, type CSSProperties } from 'react';
import { getBestellingen, getMollieStatus, terugbetaalBestelling, updateBestellingStatus, type MollieStatus, type WebshopOrder } from '../api/client';
import { getVerkoper } from '../auth';
import { isAdminRol } from '../rechten';

const STATUSSEN = ['NIEUW', 'IN_BEHANDELING', 'KLAAR', 'AFGEHAALD', 'GELEVERD', 'GEANNULEERD'];
const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);
const kleur: Record<string, string> = {
  NIEUW: '#b45309', IN_BEHANDELING: '#2563eb', KLAAR: '#16a34a', AFGEHAALD: '#6b7280', GELEVERD: '#6b7280', GEANNULEERD: '#b91c1c',
};
const restVan = (o: WebshopOrder, l: WebshopOrder['lijnen'][number]) => Math.round((Number(l.aantal) - (o.terugPerProduct[l.productId] ?? 0)) * 1000) / 1000;

// Geeft weer of online betalen aan staat, zodat je de Mollie-koppeling hier kan nakijken.
function MollieMelding({ m }: { m: MollieStatus }) {
  const stijl: CSSProperties = { fontSize: 13, padding: '8px 12px', borderRadius: 8, margin: '10px 0', background: '#f3f4f6', color: '#374151' };
  if (m.modus === 'UIT') return <div style={{ ...stijl, background: '#fef3c7', color: '#92400e' }}>Online betalen staat uit: zet <code>MOLLIE_API_KEY</code> op Render. Tot dan kan er niet besteld worden.</div>;
  if (m.fout) return <div style={{ ...stijl, background: '#fee2e2', color: '#991b1b' }}>Mollie geeft een fout: {m.fout}</div>;
  return (
    <div style={stijl}>
      {m.modus === 'TEST' ? <b>Mollie staat in testmodus: geen echt geld, testbestellingen tellen nergens mee. </b> : 'Mollie staat aan. '}
      Betaalmethoden: {m.methoden.join(', ') || 'geen'}.
      {m.trageMethoden.length > 0 && <div style={{ color: '#b91c1c', marginTop: 4 }}>Zet {m.trageMethoden.join(' en ')} uit in Mollie: daarmee komt de bevestiging pas later en kan een bestelling te laat binnenkomen.</div>}
    </div>
  );
}

// Terugbetalen via Mollie: alles of een deel, per artikel. Telt als negatieve ontvangst op de dag van de terugbetaling.
function TerugbetaalPaneel({ o, onKlaar, onSluit }: { o: WebshopOrder; onKlaar: (melding: string) => void; onSluit: () => void }) {
  const open = o.lijnen.filter((l) => restVan(o, l) > 0);
  const [aantallen, setAantallen] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.productId, String(restVan(o, l))])));
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const gekozen = open
    .map((l) => ({ l, aantal: Number((aantallen[l.productId] ?? '').replace(',', '.')) }))
    .filter((x) => x.aantal > 0);
  const bedrag = gekozen.reduce((s, x) => s + Math.round(Math.round(Number(x.l.eenheidsprijs) * 100) * x.aantal) / 100, 0);

  async function bevestig() {
    setBezig(true); setFout('');
    try {
      const r = await terugbetaalBestelling(o.id, gekozen.map((x) => ({ productId: x.l.productId, aantal: x.aantal })));
      onKlaar(`${euro(r.bedrag)} wordt terugbetaald via Mollie${r.volledig ? '; de bestelling is geannuleerd' : ''}.`);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Terugbetalen mislukt');
      setBezig(false);
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Wat betaal je terug? De stock wordt teruggeboekt.</div>
      {open.map((l) => (
        <label key={l.productId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <input value={aantallen[l.productId] ?? ''} inputMode="decimal" onChange={(e) => setAantallen({ ...aantallen, [l.productId]: e.target.value })} aria-label={`Aantal ${l.product.naam}`} style={{ ...inp, marginBottom: 0, width: 64, padding: 4 }} />
          <span>van {restVan(o, l)} × {l.product.naam} ({euro(l.eenheidsprijs)})</span>
        </label>
      ))}
      {fout && <div style={{ color: 'crimson', marginTop: 6 }}>{fout}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={bevestig} disabled={bezig || bedrag <= 0} style={{ padding: '7px 12px', border: 'none', borderRadius: 6, background: '#b91c1c', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{bezig ? 'Bezig…' : `${euro(bedrag)} terugbetalen`}</button>
        <button onClick={onSluit} disabled={bezig} style={{ padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Sluiten</button>
      </div>
    </div>
  );
}

// Beheer van webshop-bestellingen: enkel betaalde bestellingen komen hier binnen.
export function Bestellingen() {
  const [lijst, setLijst] = useState<WebshopOrder[]>([]);
  const [filter, setFilter] = useState('');
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [mollie, setMollie] = useState<MollieStatus | null>(null);
  const [terugId, setTerugId] = useState<string | null>(null);
  const isAdmin = isAdminRol(getVerkoper()?.rol);

  async function laad() { setLijst(await getBestellingen()); }
  useEffect(() => { laad(); getMollieStatus().then(setMollie).catch(() => {}); }, []);

  async function zetStatus(id: string, status: string) {
    setFout(''); setMelding('');
    if (status === 'GEANNULEERD' && !window.confirm('Deze bestelling annuleren? De stock wordt teruggeboekt en je kan ze daarna niet meer heropenen.')) return;
    try {
      await updateBestellingStatus(id, status);
      setLijst((l) => l.map((o) => (o.id === id ? { ...o, status, geannuleerd: o.geannuleerd || status === 'GEANNULEERD' } : o)));
    } catch (e) { setFout(e instanceof Error ? e.message : 'Status wijzigen mislukt'); }
  }

  const zichtbaar = filter ? lijst.filter((o) => (o.status ?? 'NIEUW') === filter) : lijst;
  const nieuw = lijst.filter((o) => (o.status ?? 'NIEUW') === 'NIEUW').length;

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Bestellingen</h2>
        {nieuw > 0 && <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 10px', borderRadius: 999, fontWeight: 600, fontSize: 13 }}>{nieuw} nieuw</span>}
      </div>
      {mollie && <MollieMelding m={mollie} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        <button onClick={() => setFilter('')} style={chip(filter === '')}>Alle</button>
        {STATUSSEN.map((s) => <button key={s} onClick={() => setFilter(s)} style={chip(filter === s)}>{s.replace('_', ' ').toLowerCase()}</button>)}
      </div>

      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534' }}>{melding}</p>}
      {zichtbaar.length === 0 && <p style={{ color: '#999' }}>Geen bestellingen.</p>}

      {zichtbaar.map((o) => {
        // De gegevens van de bestelling zelf; oudere bestellingen hebben die enkel op de klant.
        const telefoon = o.bestelTelefoon ?? o.klant?.telefoon;
        const adres = o.bestelAdres ?? o.klant?.adres;
        const geannuleerd = o.geannuleerd || o.status === 'GEANNULEERD';
        const nogTerug = o.kanTerugbetalen && o.lijnen.some((l) => restVan(o, l) > 0);
        return (
        <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>{o.bestelNaam ?? o.klant?.naam ?? 'Onbekende klant'} <span style={{ fontWeight: 400, fontSize: 13, color: '#6b7280' }}>{o.bestelnummer}</span></div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {o.bestelEmail ?? o.klant?.email ?? ''}{telefoon ? ` · ${telefoon}` : ''} · {new Date(o.datum).toLocaleString('nl-BE')}
              </div>
            </div>
            <span style={{ padding: '4px 10px', borderRadius: 8, background: '#f3f4f6', fontSize: 13 }}>
              {o.leverwijze === 'LEVEREN' ? '🚚 Leveren' : '🏬 Afhalen'}
              {o.gewensteDag ? ` · ${new Date(o.gewensteDag + 'T12:00:00').toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })}${o.gewensteTijd ? ' ' + o.gewensteTijd : ''}` : ''}
            </span>
            {o.testBetaling && <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 13, fontWeight: 700, background: '#fef3c7', color: '#92400e' }}>TEST</span>}
            <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: o.betaald ? '#dcfce7' : '#fef3c7', color: o.betaald ? '#166534' : '#b45309' }}>
              {o.betaald ? '✓ Betaald' : 'Nog te betalen'}
            </span>
            <strong>{euro(o.totaal)}</strong>
            <select value={o.status ?? 'NIEUW'} disabled={geannuleerd} onChange={(e) => zetStatus(o.id, e.target.value)}
              style={{ ...inp, marginBottom: 0, fontWeight: 600, color: kleur[o.status ?? 'NIEUW'] ?? '#111' }}>
              {/* Een betaalde bestelling annuleer je via Terugbetalen, want dan moet het geld ook terug. */}
              {STATUSSEN.filter((s) => s !== 'GEANNULEERD' || !o.kanTerugbetalen || geannuleerd).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          {o.leverwijze === 'LEVEREN' && adres && (
            <div style={{ fontSize: 13, color: '#374151', marginTop: 8 }}>📍 {adres}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 14, color: '#374151' }}>
            {o.lijnen.map((l, i) => (
              <span key={i}>{Number(l.aantal)}× {l.product.naam}{i < o.lijnen.length - 1 ? ' · ' : ''}</span>
            ))}
          </div>
          {o.kortingReden && <div style={{ fontSize: 13, color: '#0d4589', marginTop: 6 }}>Korting: {o.kortingReden}</div>}
          {o.terugbetaald > 0 && <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 6 }}>{euro(o.terugbetaald)} terugbetaald</div>}
          {nogTerug && isAdmin && terugId !== o.id && (
            <button onClick={() => { setTerugId(o.id); setMelding(''); setFout(''); }} style={{ marginTop: 8, padding: '5px 10px', border: '1px solid #b91c1c', borderRadius: 6, background: '#fff', color: '#b91c1c', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Terugbetalen…</button>
          )}
          {nogTerug && !isAdmin && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Terugbetalen of annuleren kan enkel een beheerder.</div>}
          {terugId === o.id && (
            <TerugbetaalPaneel o={o} onSluit={() => setTerugId(null)} onKlaar={(m) => { setTerugId(null); setMelding(m); laad(); }} />
          )}
        </div>
        );
      })}
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
function chip(actief: boolean): CSSProperties {
  return { padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13, border: actief ? '2px solid #0d4589' : '1px solid #cbd5e1', background: actief ? '#eff6ff' : '#fff', fontWeight: actief ? 600 : 400 };
}
