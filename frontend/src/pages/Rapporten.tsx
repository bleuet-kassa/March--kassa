import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  getMaandoverzicht, getCategorieRapport, getKassaVsFacturen,
  type MaandRij, type CategorieRapport, type KassaVsFacturen,
} from '../api/client';

const euro = (n: number) => '€ ' + Number(n).toFixed(2);
const MAAND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Managementrapporten (enkel admins): maandoverzicht om jaren te vergelijken,
// en per productcategorie omzet, aandeel en marge.
export function Rapporten() {
  const [maanden, setMaanden] = useState<MaandRij[]>([]);
  const jaarNu = new Date().getFullYear();
  const [van, setVan] = useState(`${jaarNu}-01-01`);
  const [tot, setTot] = useState(new Date().toISOString().slice(0, 10));
  const [cat, setCat] = useState<CategorieRapport | null>(null);
  const [kf, setKf] = useState<KassaVsFacturen | null>(null);

  useEffect(() => { getMaandoverzicht().then(setMaanden); }, []);
  useEffect(() => {
    getCategorieRapport(van, tot + 'T23:59:59').then(setCat);
    getKassaVsFacturen(van, tot + 'T23:59:59').then(setKf);
  }, [van, tot]);

  // Pivot: rijen = maanden, kolommen = jaren.
  const { jaren, cel, jaarTotaal } = useMemo(() => {
    const jaren = [...new Set(maanden.map((m) => m.jaar))].sort();
    const cel: Record<string, number> = {};
    const jaarTotaal: Record<number, number> = {};
    for (const m of maanden) {
      cel[`${m.jaar}-${m.maand}`] = m.omzetIncl;
      jaarTotaal[m.jaar] = (jaarTotaal[m.jaar] ?? 0) + m.omzetIncl;
    }
    return { jaren, cel, jaarTotaal };
  }, [maanden]);

  return (
    <div style={{ maxWidth: 900 }}>
      <h2>Rapporten</h2>

      <h3>Maandoverzicht (omzet incl. BTW) — jaren vergelijken</h3>
      {jaren.length === 0 ? <p style={{ color: '#999' }}>Nog geen omzetgegevens.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 14, minWidth: 360 }}>
            <thead>
              <tr>
                <th style={th}>Maand</th>
                {jaren.map((j) => <th key={j} style={{ ...th, textAlign: 'right' }}>{j}</th>)}
              </tr>
            </thead>
            <tbody>
              {MAAND.map((naam, i) => (
                <tr key={naam} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '4px 8px' }}>{naam}</td>
                  {jaren.map((j) => {
                    const v = cel[`${j}-${i + 1}`];
                    return <td key={j} style={{ padding: '4px 8px', textAlign: 'right', color: v ? '#111' : '#ccc' }}>{v ? euro(v) : '—'}</td>;
                  })}
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700 }}>
                <td style={{ padding: '4px 8px' }}>Totaal</td>
                {jaren.map((j) => <td key={j} style={{ padding: '4px 8px', textAlign: 'right' }}>{euro(jaarTotaal[j] ?? 0)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 28 }}>Per categorie — omzet, aandeel & marge</h3>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: '#666' }}>Van <input type="date" value={van} onChange={(e) => setVan(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 13, color: '#666' }}>Tot <input type="date" value={tot} onChange={(e) => setTot(e.target.value)} style={inp} /></label>
        <button onClick={() => { setVan(`${jaarNu}-01-01`); setTot(new Date().toISOString().slice(0, 10)); }} style={btn}>Dit jaar</button>
        <button onClick={() => { const d = new Date(); setVan(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`); setTot(new Date().toISOString().slice(0, 10)); }} style={btn}>Deze maand</button>
      </div>

      {kf && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={kaart}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Kassaverkopen (particulier)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{euro(kf.kasticket.omzetIncl)}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{kf.kasticket.aantal} tickets · incl. BTW</div>
          </div>
          <div style={kaart}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Facturen (B2B)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{euro(kf.facturen.omzetIncl)}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{kf.facturen.aantal} facturen · incl. BTW</div>
          </div>
        </div>
      )}

      {cat && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>Categorie</th>
                <th style={{ ...th, textAlign: 'right' }}>Omzet (excl.)</th>
                <th style={{ ...th, textAlign: 'right' }}>Aandeel</th>
                <th style={{ ...th, textAlign: 'right' }}>Inkoop</th>
                <th style={{ ...th, textAlign: 'right' }}>Marge €</th>
                <th style={{ ...th, textAlign: 'right' }}>Marge %</th>
              </tr>
            </thead>
            <tbody>
              {cat.categorieen.map((c) => (
                <tr key={c.categorie} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '5px 8px' }}>{c.categorie}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{euro(c.omzetExcl)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{c.aandeelPct.toFixed(1)}%</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666' }}>{euro(c.inkoop)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{euro(c.marge)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: c.margePct < 0 ? 'crimson' : '#166534' }}>{c.margePct.toFixed(1)}%</td>
                </tr>
              ))}
              {cat.categorieen.length === 0 && <tr><td colSpan={6} style={{ padding: 12, color: '#999' }}>Geen verkopen in deze periode.</td></tr>}
              {cat.categorieen.length > 0 && (
                <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700 }}>
                  <td style={{ padding: '5px 8px' }}>Totaal</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{euro(cat.totaal.omzetExcl)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>100%</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{euro(cat.totaal.inkoop)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{euro(cat.totaal.marge)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{cat.totaal.margePct.toFixed(1)}%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' };
const inp: CSSProperties = { padding: 6, border: '1px solid #cbd5e1', borderRadius: 6, marginLeft: 4 };
const btn: CSSProperties = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const kaart: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', minWidth: 200 };
