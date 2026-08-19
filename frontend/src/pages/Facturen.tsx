import { useEffect, useState, type CSSProperties } from 'react';
import {
  getMeta, factuurInlezen, factuurVerwerken, createLeverancier,
  type Meta, type VerwerkRegel,
} from '../api/client';

type Rij = VerwerkRegel & { _key: number };

// Factuur-import (Fase 1): upload een leveranciersfactuur (PDF) → herkende regels
// controleren/aanpassen → producten aanmaken/bijwerken en voorraad bijboeken.
// Herkenning via Claude-AI als er een API-sleutel is ingesteld, anders lokaal.
export function Facturen() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bron, setBron] = useState<string>('');
  const [locatieId, setLocatieId] = useState('');
  const [leverancierId, setLeverancierId] = useState('');
  const [rijen, setRijen] = useState<Rij[]>([]);
  const [klaar, setKlaar] = useState<{ nieuw: number; bijgeboekt: number; totaal: number } | null>(null);

  useEffect(() => {
    getMeta().then((m) => {
      setMeta(m);
      setLocatieId(m.locaties[0]?.id ?? '');
    });
  }, []);

  const btw21 = meta?.btwTarieven.find((b) => Number(b.percentage) === 21)?.id ?? meta?.btwTarieven[0]?.id ?? '';
  const verkoopUitInkoop = (inkoop: number) => Math.round((inkoop * 2.5) / 0.5) * 0.5;

  async function kiesBestand(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !meta) return;
    setFout(''); setMelding(''); setKlaar(null); setBezig(true);
    try {
      const res = await factuurInlezen(file);
      setBron(res.bron);
      if (res.waarschuwing) setMelding(res.waarschuwing);
      // koppel gedetecteerde leverancier indien die al bestaat
      const gevonden = res.leverancier
        ? meta.leveranciers.find((l) => l.naam.toLowerCase() === res.leverancier!.toLowerCase())
        : undefined;
      if (gevonden) setLeverancierId(gevonden.id);
      setRijen(
        res.regels.map((r, i) => ({
          _key: i,
          naam: r.omschrijving,
          aantal: r.aantal,
          inkoopprijs: r.eenheidsprijs,
          verkoopprijs: verkoopUitInkoop(r.eenheidsprijs),
          btwTariefId: btw21,
          isAlcohol: true,
          categorieId: null,
        })),
      );
      if (res.regels.length === 0) setFout('Geen regels herkend. Probeer een AI-sleutel of controleer de PDF.');
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Inlezen mislukt');
    } finally {
      setBezig(false);
      e.target.value = '';
    }
  }

  function wijzig(key: number, veld: keyof Rij, waarde: string | number | boolean) {
    setRijen((rs) => rs.map((r) => (r._key === key ? { ...r, [veld]: waarde } : r)));
  }
  function verwijder(key: number) {
    setRijen((rs) => rs.filter((r) => r._key !== key));
  }

  async function nieuweLeverancier() {
    const naam = window.prompt('Naam leverancier?');
    if (!naam?.trim()) return;
    const l = await createLeverancier(naam.trim());
    setMeta(await getMeta());
    setLeverancierId(l.id);
  }

  async function verwerk() {
    if (!rijen.length || !locatieId) return;
    setBezig(true); setFout('');
    try {
      const payload: VerwerkRegel[] = rijen.map((r) => ({
        naam: r.naam.trim(),
        aantal: Number(r.aantal),
        inkoopprijs: Number(r.inkoopprijs),
        verkoopprijs: Number(r.verkoopprijs),
        btwTariefId: r.btwTariefId,
        isAlcohol: r.isAlcohol,
        leverancierId: leverancierId || null,
        categorieId: r.categorieId || null,
      }));
      const res = await factuurVerwerken(payload, locatieId);
      setKlaar(res);
      setRijen([]);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Verwerken mislukt');
    } finally {
      setBezig(false);
    }
  }

  if (!meta) return <div>Laden…</div>;

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2>Factuur inlezen</h2>
      <p style={{ color: '#6b7280', fontSize: 14 }}>
        Upload een leveranciersfactuur (PDF). De regels worden herkend; controleer en pas aan
        vóór je ze toevoegt. {bron && <>Herkenning: <strong>{bron === 'ai' ? 'AI' : 'lokaal'}</strong>.</>}
      </p>

      <input type="file" accept="application/pdf" onChange={kiesBestand} disabled={bezig} />
      {bezig && <span style={{ marginLeft: 10 }}>Bezig…</span>}
      {melding && <p style={{ color: '#92400e', background: '#fef3c7', padding: '8px 12px', borderRadius: 8 }}>{melding}</p>}
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      {klaar && (
        <p style={{ color: '#16a34a', fontWeight: 600 }}>
          ✓ Verwerkt: {klaar.nieuw} nieuw, {klaar.bijgeboekt} bijgeboekt (totaal {klaar.totaal}).
        </p>
      )}

      {rijen.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }}>
            <div>
              <div style={muted}>Voorraad boeken op</div>
              <select value={locatieId} onChange={(e) => setLocatieId(e.target.value)} style={inp}>
                {meta.locaties.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
              </select>
            </div>
            <div>
              <div style={muted}>Leverancier (voor alle regels)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={leverancierId} onChange={(e) => setLeverancierId(e.target.value)} style={inp}>
                  <option value="">—</option>
                  {meta.leveranciers.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
                </select>
                <button onClick={nieuweLeverancier} style={btnGrijs}>+</button>
              </div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
                <th style={{ padding: 4 }}>Naam</th>
                <th style={{ padding: 4, width: 60 }}>Aantal</th>
                <th style={{ padding: 4, width: 90 }}>Inkoop €</th>
                <th style={{ padding: 4, width: 90 }}>Verkoop €</th>
                <th style={{ padding: 4, width: 110 }}>BTW</th>
                <th style={{ padding: 4, width: 50 }}>Alc.</th>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r._key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: 3 }}><input value={r.naam} onChange={(e) => wijzig(r._key, 'naam', e.target.value)} style={{ ...inp, marginBottom: 0 }} /></td>
                  <td style={{ padding: 3 }}><input value={r.aantal} onChange={(e) => wijzig(r._key, 'aantal', Number(e.target.value))} inputMode="numeric" style={{ ...inp, marginBottom: 0 }} /></td>
                  <td style={{ padding: 3 }}><input value={r.inkoopprijs} onChange={(e) => wijzig(r._key, 'inkoopprijs', Number(e.target.value))} inputMode="decimal" style={{ ...inp, marginBottom: 0 }} /></td>
                  <td style={{ padding: 3 }}><input value={r.verkoopprijs} onChange={(e) => wijzig(r._key, 'verkoopprijs', Number(e.target.value))} inputMode="decimal" style={{ ...inp, marginBottom: 0 }} /></td>
                  <td style={{ padding: 3 }}>
                    <select value={r.btwTariefId} onChange={(e) => wijzig(r._key, 'btwTariefId', e.target.value)} style={{ ...inp, marginBottom: 0 }}>
                      {meta.btwTarieven.map((b) => <option key={b.id} value={b.id}>{b.percentage}%</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 3, textAlign: 'center' }}><input type="checkbox" checked={!!r.isAlcohol} onChange={(e) => wijzig(r._key, 'isAlcohol', e.target.checked)} /></td>
                  <td style={{ textAlign: 'right' }}><button onClick={() => verwijder(r._key)} style={{ border: 'none', background: 'none', color: 'crimson', cursor: 'pointer', fontSize: 18 }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={muted}>
            Regels zonder gekozen bestaand product worden als <strong>nieuw product</strong> aangemaakt
            (met automatische in-store barcode). Bestaat de naam al exact, gebruik dan eerst het
            beheerscherm om te koppelen.
          </p>
          <button onClick={verwerk} disabled={bezig} style={{ ...btnGroen, width: '100%', marginTop: 8 }}>
            {bezig ? 'Bezig…' : `${rijen.length} regels verwerken → producten + voorraad`}
          </button>
        </>
      )}
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btnGroen: CSSProperties = { padding: 12, border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const btnGrijs: CSSProperties = { padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
