import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  getFiltersBeheer, getProductenBeheer, maakFilter, verwijderFilter, wijzigFilter, zetFilterProduct,
  type FilterBeheer, type ProductVol,
} from '../api/client';

// Zoekfilters van de webshop: zelf aanmaken (bv. "Vegetarisch", "Feestmenu") en aanvinken welke
// artikels eronder vallen. Klanten zien enkel filters met minstens één artikel dat online staat.
export function WebshopFilters() {
  const [filters, setFilters] = useState<FilterBeheer[]>([]);
  const [producten, setProducten] = useState<ProductVol[]>([]);
  const [gekozen, setGekozen] = useState('');
  const [nieuw, setNieuw] = useState('');
  const [naam, setNaam] = useState('');
  const [zoek, setZoek] = useState('');
  const [fout, setFout] = useState('');

  async function laad(kies?: string) {
    const f = await getFiltersBeheer();
    setFilters(f);
    const id = kies ?? gekozen;
    const actief = f.find((x) => x.id === id) ?? f[0];
    setGekozen(actief?.id ?? '');
    setNaam(actief?.naam ?? '');
  }
  useEffect(() => {
    laad().catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'));
    getProductenBeheer('').then(setProducten).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filter = filters.find((f) => f.id === gekozen);
  const staatOnline = (p: ProductVol) => p.webshopZichtbaar && p.actief;
  // Wat online staat, plus wat al aangevinkt is maar intussen offline ging (zodat je het kan uitvinken).
  const online = useMemo(
    () => producten
      .filter((p) => (staatOnline(p) || filter?.productIds.includes(p.id)) && (!zoek || p.naam.toLowerCase().includes(zoek.toLowerCase())))
      .sort((a, b) => a.naam.localeCompare(b.naam)),
    [producten, zoek, filter],
  );

  async function doe(actie: () => Promise<unknown>, kies?: string) {
    setFout('');
    try { await actie(); await laad(kies); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt'); }
  }
  async function voegToe() {
    if (!nieuw.trim()) return;
    setFout('');
    try { const f = await maakFilter(nieuw.trim()); setNieuw(''); await laad(f.id); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Toevoegen mislukt'); }
  }
  async function schakel(productId: string, aan: boolean) {
    if (!filter) return;
    setFout('');
    setFilters((lijst) => lijst.map((f) => (f.id === filter.id ? { ...f, productIds: aan ? [...f.productIds, productId] : f.productIds.filter((x) => x !== productId) } : f)));
    try { await zetFilterProduct(filter.id, productId, aan); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); await laad(); }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        Maak filters aan waarop klanten in de webshop kunnen zoeken, en vink aan welke artikels erbij horen. Klanten kunnen daarnaast altijd op een woord zoeken.
      </p>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input value={nieuw} onChange={(e) => setNieuw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && voegToe()} placeholder="Nieuwe filter, bv. Vegetarisch" maxLength={30} aria-label="Nieuwe filter" style={{ ...inp, flex: 1 }} />
            <button onClick={voegToe} style={btnBlauw}>+</button>
          </div>
          {filters.map((f, i) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: f.id === gekozen ? '#eff6ff' : 'transparent', border: f.id === gekozen ? '1px solid #bfdbfe' : '1px solid transparent' }}
              onClick={() => { setGekozen(f.id); setNaam(f.naam); }}>
              <span style={{ flex: 1, fontWeight: f.id === gekozen ? 600 : 400 }}>{f.naam}</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{f.productIds.length}</span>
              <button onClick={(e) => { e.stopPropagation(); doe(() => wijzigFilter(f.id, { omhoog: true })); }} disabled={i === 0} aria-label={`${f.naam} hoger`} style={btnPijl}>↑</button>
              <button onClick={(e) => { e.stopPropagation(); doe(() => wijzigFilter(f.id, { omlaag: true })); }} disabled={i === filters.length - 1} aria-label={`${f.naam} lager`} style={btnPijl}>↓</button>
            </div>
          ))}
          {filters.length === 0 && <div style={{ color: '#999' }}>Nog geen filters.</div>}
        </div>

        {filter && (
          <div style={{ flex: '2 1 360px', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <input value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={30} aria-label="Naam van de filter" style={{ ...inp, flex: 1, minWidth: 140 }} />
              <button onClick={() => doe(() => wijzigFilter(filter.id, { naam }), filter.id)} disabled={naam.trim() === filter.naam} style={btnMini}>Naam bewaren</button>
              <button onClick={() => { if (window.confirm(`Filter "${filter.naam}" verwijderen?`)) doe(() => verwijderFilter(filter.id), ''); }} style={{ ...btnMini, color: 'crimson' }}>Verwijderen</button>
            </div>
            <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek een artikel…" aria-label="Zoek een artikel" style={{ ...inp, width: '100%', marginBottom: 8 }} />
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Artikels die online staan · aangevinkt = valt onder "{filter.naam}"</div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {online.map((p) => (
                <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                  <input type="checkbox" checked={filter.productIds.includes(p.id)} onChange={(e) => schakel(p.id, e.target.checked)} />
                  <span style={{ flex: 1 }}>{p.naam}{!staatOnline(p) && <span style={{ color: '#b45309', fontSize: 12 }}> · staat niet online</span>}</span>
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>{p.afdeling?.naam ?? ''}</span>
                </label>
              ))}
              {online.length === 0 && <div style={{ color: '#999' }}>Geen artikels online{zoek ? ' met die naam' : ''}.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inp: CSSProperties = { padding: 7, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const btnBlauw: CSSProperties = { padding: '7px 14px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnPijl: CSSProperties = { padding: '0 6px', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '18px' };
