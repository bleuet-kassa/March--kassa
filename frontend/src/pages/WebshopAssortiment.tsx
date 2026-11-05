import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  getProductenBeheer, setProductWebshop, setProductAllergenen, getMeta,
  type ProductVol, type Meta,
} from '../api/client';
import { ProductForm } from './Beheer';
import { WebshopKalender } from './WebshopKalender';

// Webshop-assortiment: snel producten in/uit de webshop zetten (dagelijks werk)
// en manueel nieuwe producten toevoegen per afdeling. Enkel actieve producten
// verschijnen effectief online — een product offline zetten aan de kassa haalt
// het automatisch uit de webshop.
export function WebshopAssortiment() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [producten, setProducten] = useState<ProductVol[]>([]);
  const [zoek, setZoek] = useState('');
  const [afdId, setAfdId] = useState('');
  const [enkelOnline, setEnkelOnline] = useState(false);
  const [bezigId, setBezigId] = useState('');
  const [form, setForm] = useState<{ product: ProductVol | null } | null>(null);
  const [tab, setTab] = useState<'assortiment' | 'kalender'>('assortiment');

  async function laadMeta() { setMeta(await getMeta()); }
  async function laadProducten() { setProducten(await getProductenBeheer(zoek)); }

  useEffect(() => { laadMeta(); }, []);
  useEffect(() => { const t = setTimeout(laadProducten, 150); return () => clearTimeout(t); }, [zoek]);

  const zichtbaar = useMemo(() => {
    return producten
      .filter((p) => (!afdId || (p.afdelingId ?? p.afdeling?.id) === afdId))
      .filter((p) => (!enkelOnline || p.webshopZichtbaar))
      .sort((a, b) => a.naam.localeCompare(b.naam));
  }, [producten, afdId, enkelOnline]);

  const aantalOnline = producten.filter((p) => p.webshopZichtbaar && p.actief).length;
  const zonderAllergenen = producten.filter((p) => p.webshopZichtbaar && p.actief && !p.allergenen?.trim()).length;

  async function bewaarAllergenen(p: ProductVol, tekst: string) {
    if (tekst.trim() === (p.allergenen ?? '')) return;
    const bijgewerkt = await setProductAllergenen(p.id, tekst);
    setProducten((lijst) => lijst.map((x) => (x.id === p.id ? { ...x, allergenen: bijgewerkt.allergenen } : x)));
  }

  async function toggle(p: ProductVol) {
    setBezigId(p.id);
    try {
      const bijgewerkt = await setProductWebshop(p.id, !p.webshopZichtbaar);
      setProducten((lijst) => lijst.map((x) => (x.id === p.id ? { ...x, webshopZichtbaar: bijgewerkt.webshopZichtbaar } : x)));
    } finally { setBezigId(''); }
  }

  if (form && meta) {
    return (
      <div style={{ maxWidth: 620 }}>
        <button onClick={() => setForm(null)} style={{ ...btnGrijs, marginBottom: 12 }}>← Terug naar assortiment</button>
        <ProductForm
          meta={meta}
          product={form.product}
          prefillAfdelingId={afdId || undefined}
          onKlaar={() => { setForm(null); laadProducten(); }}
          onMetaWijzig={laadMeta}
        />
      </div>
    );
  }

  // Twee onderdelen: wat er online staat, en op welke dagen klanten kunnen afhalen of laten leveren.
  const tabs = (
    <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
      {([['assortiment', 'Assortiment'], ['kalender', 'Afhaal- en leverdagen']] as const).map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)} style={{ padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13, border: tab === k ? '2px solid #0d4589' : '1px solid #cbd5e1', background: tab === k ? '#eff6ff' : '#fff', fontWeight: tab === k ? 600 : 400 }}>{label}</button>
      ))}
    </div>
  );
  if (tab === 'kalender') {
    return (
      <div style={{ maxWidth: 900 }}>
        <h2 style={{ margin: 0 }}>Webshop</h2>
        {tabs}
        <WebshopKalender />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {tabs}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Webshop-assortiment</h2>
        <span style={{ color: '#6b7280', fontSize: 14 }}><strong>{aantalOnline}</strong> producten online</span>
        {zonderAllergenen > 0 && <span style={{ color: '#92400e', background: '#fef3c7', padding: '2px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600 }}>{zonderAllergenen} online zonder allergenen</span>}
      </div>
      <p style={{ color: '#6b7280', marginTop: 6 }}>
        Vink aan wat online mag staan. Enkel <strong>actieve</strong> producten verschijnen in de webshop.
        Vul bij voeding de allergenen in (of "geen"); leeg toont de webshop "vraag het ons". Het vakje bewaart zodra je eruit klikt.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 14px' }}>
        <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek product…" style={{ ...inp, maxWidth: 220, marginBottom: 0 }} />
        <select value={afdId} onChange={(e) => setAfdId(e.target.value)} style={{ ...inp, marginBottom: 0 }}>
          <option value="">Alle afdelingen</option>
          {meta?.afdelingen.map((a) => <option key={a.id} value={a.id}>{a.naam}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151' }}>
          <input type="checkbox" checked={enkelOnline} onChange={(e) => setEnkelOnline(e.target.checked)} />
          enkel online
        </label>
        <button onClick={() => setForm({ product: null })} style={{ ...btnBlauw, marginLeft: 'auto' }}>+ Nieuw product</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: 6 }}>Product</th>
            <th style={{ padding: 6 }}>Afdeling</th>
            <th style={{ padding: 6 }}>Allergenen</th>
            <th style={{ padding: 6, textAlign: 'right' }}>Prijs</th>
            <th style={{ padding: 6 }}>Status</th>
            <th style={{ padding: 6, textAlign: 'center' }}>In webshop</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {zichtbaar.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: p.actief ? 1 : 0.55 }}>
              <td style={{ padding: 6 }}>{p.naam}{p.isAlcohol && ' 🍷'}</td>
              <td style={{ padding: 6, color: '#6b7280' }}>{p.afdeling?.naam ?? '—'}</td>
              <td style={{ padding: 6 }}>
                {p.webshopZichtbaar && (
                  <input key={p.allergenen ?? ''} defaultValue={p.allergenen ?? ''} maxLength={500} placeholder="bv. gluten, melk, of: geen" aria-label={`Allergenen van ${p.naam}`}
                    onBlur={(e) => bewaarAllergenen(p, e.target.value)} style={{ ...inp, marginBottom: 0, padding: 5, fontSize: 13, width: 170 }} />
                )}
              </td>
              <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>€ {Number(p.verkoopprijs).toFixed(2)}</td>
              <td style={{ padding: 6 }}>
                {p.actief
                  ? <span style={{ color: '#166534' }}>actief</span>
                  : <span style={{ color: '#b91c1c' }}>offline</span>}
              </td>
              <td style={{ padding: 6, textAlign: 'center' }}>
                <button
                  onClick={() => toggle(p)}
                  disabled={bezigId === p.id}
                  title={p.webshopZichtbaar ? 'Uit de webshop halen' : 'In de webshop tonen'}
                  style={{
                    width: 46, height: 26, borderRadius: 999, border: '1px solid ' + (p.webshopZichtbaar ? '#0d4589' : '#cbd5e1'),
                    background: p.webshopZichtbaar ? '#0d4589' : '#e5e7eb', position: 'relative', cursor: 'pointer',
                    transition: 'background .15s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: p.webshopZichtbaar ? 22 : 2, width: 20, height: 20,
                    borderRadius: '50%', background: '#fff', transition: 'left .15s',
                  }} />
                </button>
                {!p.actief && p.webshopZichtbaar && <div style={{ fontSize: 11, color: '#b91c1c' }}>toont pas als actief</div>}
              </td>
              <td style={{ padding: 6, textAlign: 'right' }}>
                <button onClick={() => setForm({ product: p })} style={btnMini}>Bewerken</button>
              </td>
            </tr>
          ))}
          {zichtbaar.length === 0 && <tr><td colSpan={7}style={{ padding: 16, color: '#999' }}>Geen producten gevonden.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnGrijs: CSSProperties = { padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
