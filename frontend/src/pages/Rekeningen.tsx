import { useEffect, useState, type CSSProperties } from 'react';
import {
  getRekeningOverzicht, nieuwRekeningBedrijf, nieuwRekeningLid,
  getBedrijfVerkopen, factureerBedrijf,
  type RekeningBedrijf, type RekeningVerkoop,
} from '../api/client';

const euro = (n: number | null | undefined) => '€ ' + Number(n ?? 0).toFixed(2);

// Lopende rekeningen: bedrijven met personeelsleden die "op rekening" kopen.
// Overzicht van het openstaande bedrag per bedrijf en per lid, met een
// factureer-knop om de openstaande verkopen af te sluiten (maandfactuur).
export function Rekeningen() {
  const [bedrijven, setBedrijven] = useState<RekeningBedrijf[]>([]);
  const [fout, setFout] = useState('');
  const [nieuwNaam, setNieuwNaam] = useState('');
  const [nieuwBtw, setNieuwBtw] = useState('');
  const [nieuwAdres, setNieuwAdres] = useState('');
  const [nieuwEmail, setNieuwEmail] = useState('');
  const [verkopen, setVerkopen] = useState<Record<string, RekeningVerkoop[]>>({});

  async function laad() { setBedrijven(await getRekeningOverzicht()); }
  useEffect(() => { laad().catch((e) => setFout(String(e))); }, []);

  async function voegBedrijfToe() {
    if (!nieuwNaam.trim()) return;
    setFout('');
    try {
      await nieuwRekeningBedrijf({ naam: nieuwNaam.trim(), btwNummer: nieuwBtw.trim() || undefined, adres: nieuwAdres.trim() || undefined, email: nieuwEmail.trim() || undefined });
      setNieuwNaam(''); setNieuwBtw(''); setNieuwAdres(''); setNieuwEmail('');
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Toevoegen mislukt'); }
  }

  async function voegLidToe(bedrijfId: string) {
    const naam = window.prompt('Naam van het personeelslid?');
    if (!naam?.trim()) return;
    const budgetTxt = window.prompt('Maandbudget (optioneel, bv. 150) — leeg = geen budget:', '');
    const budget = budgetTxt && budgetTxt.trim() ? Number(budgetTxt.replace(',', '.')) : undefined;
    try {
      await nieuwRekeningLid({ bedrijfId, naam: naam.trim(), budget: budget && budget > 0 ? budget : undefined });
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Toevoegen mislukt'); }
  }

  async function toonVerkopen(bedrijfId: string) {
    if (verkopen[bedrijfId]) { setVerkopen((v) => { const k = { ...v }; delete k[bedrijfId]; return k; }); return; }
    const rows = await getBedrijfVerkopen(bedrijfId);
    setVerkopen((v) => ({ ...v, [bedrijfId]: rows }));
  }

  async function factureer(b: RekeningBedrijf) {
    if (!window.confirm(`Alle openstaande verkopen van ${b.naam} (${euro(b.openstaand)}) als gefactureerd markeren?`)) return;
    const r = await factureerBedrijf(b.id);
    window.alert(`${r.aantal} verkopen afgesloten voor een totaal van ${euro(r.totaal)}.`);
    await laad();
    setVerkopen((v) => { const k = { ...v }; delete k[b.id]; return k; });
  }

  const totaalOpenstaand = bedrijven.reduce((s, b) => s + (b.openstaand ?? 0), 0);

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Lopende rekeningen</h2>
        <span style={{ color: '#6b7280' }}>Totaal openstaand: <strong>{euro(totaalOpenstaand)}</strong></span>
      </div>
      <p style={{ color: '#6b7280', marginTop: 4 }}>Bedrijven waarvan personeelsleden "op rekening" kopen. Op het einde van de maand factureer je het openstaande bedrag.</p>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, margin: '12px 0 20px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={muted}>Bedrijf</div><input value={nieuwNaam} onChange={(e) => setNieuwNaam(e.target.value)} style={{ ...inp, width: 180 }} /></div>
        <div><div style={muted}>BTW-nummer</div><input value={nieuwBtw} onChange={(e) => setNieuwBtw(e.target.value)} placeholder="BE0..." style={{ ...inp, width: 140 }} /></div>
        <div><div style={muted}>Adres</div><input value={nieuwAdres} onChange={(e) => setNieuwAdres(e.target.value)} style={{ ...inp, width: 180 }} /></div>
        <div><div style={muted}>E-mail</div><input value={nieuwEmail} onChange={(e) => setNieuwEmail(e.target.value)} style={{ ...inp, width: 160 }} /></div>
        <button onClick={voegBedrijfToe} style={btnBlauw}>Bedrijf toevoegen</button>
      </div>

      {bedrijven.map((b) => (
        <div key={b.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{b.naam}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{b.btwNummer ?? ''}{b.email ? ` · ${b.email}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Openstaand</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: (b.openstaand ?? 0) > 0 ? '#b45309' : '#166534' }}>{euro(b.openstaand)}</div>
            </div>
            <button onClick={() => toonVerkopen(b.id)} style={btnMini}>{verkopen[b.id] ? 'Verberg' : 'Verkopen'}</button>
            <button onClick={() => factureer(b)} disabled={(b.openstaand ?? 0) <= 0} style={{ ...btnBlauw, opacity: (b.openstaand ?? 0) <= 0 ? 0.5 : 1 }}>Factureren</button>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {b.leden.map((l) => (
              <div key={l.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', opacity: l.actief === false ? 0.5 : 1 }}>
                <div style={{ fontWeight: 600 }}>{l.naam}</div>
                <div style={{ fontSize: 13, color: '#374151' }}>
                  Verbruikt: <strong>{euro(l.verbruikt)}</strong>
                  {l.budget != null && <> / budget {euro(l.budget)}{(l.verbruikt ?? 0) > l.budget && <span style={{ color: 'crimson' }}> ⚠</span>}</>}
                </div>
              </div>
            ))}
            <button onClick={() => voegLidToe(b.id)} style={{ ...btnMini, border: '1px dashed #94a3b8', color: '#2563eb' }}>+ Personeelslid</button>
          </div>

          {verkopen[b.id] && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #eee' }}>
                  <th style={{ padding: 4 }}>Datum</th><th style={{ padding: 4 }}>Lid</th><th style={{ padding: 4 }}>Artikels</th><th style={{ padding: 4, textAlign: 'right' }}>Bedrag</th>
                </tr>
              </thead>
              <tbody>
                {verkopen[b.id].map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: 4 }}>{new Date(v.datum).toLocaleString('nl-BE')}</td>
                    <td style={{ padding: 4 }}>{v.lid ?? '-'}</td>
                    <td style={{ padding: 4, color: '#6b7280' }}>{v.artikels.join(' · ')}</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{euro(v.totaal)}</td>
                  </tr>
                ))}
                {verkopen[b.id].length === 0 && <tr><td colSpan={4} style={{ padding: 8, color: '#999' }}>Geen openstaande verkopen.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {bedrijven.length === 0 && <p style={{ color: '#999' }}>Nog geen bedrijven. Voeg er hierboven een toe.</p>}
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
