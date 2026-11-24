import { useEffect, useState, type CSSProperties } from 'react';
import {
  getVoorraadArtikel, voorraadOntvangen, voorraadAfboeken, voorraadTellen, zetThtNodig,
  type VoorraadArtikel, type ThtStatus,
} from '../api/client';

const vandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
export const datumNl = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
export const hoeveelheid = (n: number, eenheid: string) =>
  eenheid === 'KG' ? `${n.toLocaleString('nl-BE', { maximumFractionDigits: 3 })} kg` : n.toLocaleString('nl-BE', { maximumFractionDigits: 3 });
const REDEN: Record<string, string> = { THT_VERLOPEN: 'THT verlopen', BESCHADIGD: 'Beschadigd', ANDERE: 'Andere reden', TELLING: 'Telling' };
type Modus = 'ontvangst' | 'afboeken' | 'tellen';

// THT-label: rood = over de THT, oranje = binnenkort, groen = in orde.
export function ThtLabel({ status, dagen }: { status: ThtStatus | null; dagen: number | null }) {
  if (!status || dagen == null) return null;
  const stijl: Record<ThtStatus, CSSProperties> = {
    VERLOPEN: { background: '#fee2e2', color: '#991b1b' },
    BIJNA: { background: '#fef3c7', color: '#92400e' },
    OK: { background: '#dcfce7', color: '#166534' },
  };
  const tekst = status === 'VERLOPEN' ? `${-dagen} d over THT` : dagen === 0 ? 'THT vandaag' : `nog ${dagen} d`;
  return <span style={{ ...stijl[status], borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{tekst}</span>;
}

// Voorraad van één artikel: stand per locatie, ontvangen (met datum en THT), afboeken, tellen,
// de ontvangsten met wat er nog van ligt, en het logboek. Op de productfiche en in Voorraad.
export function VoorraadDetail({ productId, onGewijzigd, metThtSchakelaar = true }: { productId: string; onGewijzigd?: () => void; metThtSchakelaar?: boolean }) {
  const [a, setA] = useState<VoorraadArtikel | null>(null);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [modus, setModus] = useState<Modus>('ontvangst');
  const [alles, setAlles] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [aantal, setAantal] = useState('');
  const [ontvangenOp, setOntvangenOp] = useState(vandaag());
  const [tht, setTht] = useState('');
  const [locatieId, setLocatieId] = useState('');
  const [aankoop, setAankoop] = useState('');
  const [opmerking, setOpmerking] = useState('');
  const [reden, setReden] = useState('THT_VERLOPEN');

  useEffect(() => {
    setA(null); setFout(''); setMelding('');
    getVoorraadArtikel(productId)
      .then((x) => { setA(x); setLocatieId(x.locaties.find((l) => l.type === 'WINKEL')?.id ?? x.locaties[0]?.id ?? ''); })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Voorraad laden mislukt'));
  }, [productId]);

  function gewijzigd(x: VoorraadArtikel, tekst: string) {
    setA(x); setMelding(tekst);
    setAantal(''); setTht(''); setAankoop(''); setOpmerking('');
    onGewijzigd?.();
    window.dispatchEvent(new Event('voorraad-gewijzigd')); // het belletje in de menubalk ververst
  }

  async function bewaar() {
    setFout(''); setMelding('');
    if (!aantal.trim()) { setFout(modus === 'tellen' ? 'Geef het getelde aantal.' : 'Geef het aantal.'); return; }
    setBezig(true);
    try {
      if (modus === 'ontvangst') gewijzigd(await voorraadOntvangen({ productId, locatieId, aantal, ontvangenOp, tht: tht || undefined, aankoopprijs: aankoop || undefined, opmerking: opmerking || undefined }), 'Ontvangst bewaard.');
      else if (modus === 'afboeken') gewijzigd(await voorraadAfboeken({ productId, locatieId, aantal, reden, opmerking: opmerking || undefined }), 'Afgeboekt.');
      else gewijzigd(await voorraadTellen({ productId, locatieId, geteld: aantal, opmerking: opmerking || undefined }), 'Telling bewaard.');
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Bewaren mislukt');
    } finally {
      setBezig(false);
    }
  }

  async function wisselTht(v: boolean) {
    setFout('');
    try { setA(await zetThtNodig(productId, v)); onGewijzigd?.(); window.dispatchEvent(new Event('voorraad-gewijzigd')); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }

  if (!a) return <div style={{ color: fout ? 'crimson' : '#6b7280' }}>{fout || 'Voorraad laden…'}</div>;
  if (!a.product.heeftVoorraad) return <div style={{ color: '#6b7280' }}>Dit artikel heeft geen voorraad (vrij bedrag of statiegeld).</div>;
  const eenheid = a.product.eenheid;
  const locNaam = a.locaties.find((l) => l.id === locatieId)?.naam ?? '';
  const huidig = a.locaties.find((l) => l.id === locatieId)?.aantal ?? 0;
  const zonder = a.locaties.reduce((s, l) => s + l.zonderOntvangst, 0);
  const loten = alles ? a.loten : a.loten.filter((l) => l.rest > 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {a.locaties.filter((l) => l.aantal !== 0 || l.type === 'WINKEL').map((l) => (
          <div key={l.id} style={tegel(l.aantal < 0)}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{l.naam}</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{hoeveelheid(l.aantal, eenheid)}</div>
          </div>
        ))}
        {a.locaties.filter((l) => l.aantal !== 0).length > 1 && (
          <div style={tegel(a.totaal < 0)}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Totaal</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{hoeveelheid(a.totaal, eenheid)}</div>
          </div>
        )}
      </div>
      {a.locaties.some((l) => l.aantal < 0) && (
        <div style={waarschuwing}>De voorraad staat onder nul: er werd meer verkocht dan ontvangen. Tel het artikel en zet de juiste stand.</div>
      )}
      {a.product.thtNodig && zonder > 0 && (
        <div style={waarschuwing}>{hoeveelheid(zonder, eenheid)} ligt er zonder geregistreerde ontvangst (dus zonder THT). Tel het artikel of geef een ontvangst in.</div>
      )}
      {metThtSchakelaar && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, margin: '6px 0 10px' }}>
          <input type="checkbox" checked={a.product.thtNodig} onChange={(e) => wisselTht(e.target.checked)} />
          THT nodig bij ontvangst <span style={{ color: '#6b7280', fontSize: 12 }}>(uit voor non-food, wijn, groenten…)</span>
        </label>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['ontvangst', 'afboeken', 'tellen'] as Modus[]).map((m) => (
          <button key={m} type="button" onClick={() => { setModus(m); setFout(''); setMelding(''); }} style={tab(modus === m)}>
            {m === 'ontvangst' ? 'Ontvangen' : m === 'afboeken' ? 'Afboeken' : 'Tellen'}
          </button>
        ))}
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={lab}>{modus === 'tellen' ? `Geteld${eenheid === 'KG' ? ' (kg)' : ''}` : `Aantal${eenheid === 'KG' ? ' (kg)' : ''}`}
          <input value={aantal} onChange={(e) => setAantal(e.target.value)} inputMode="decimal" style={{ ...inp, width: 90 }} />
        </label>
        {a.locaties.length > 1 && (
          <label style={lab}>Locatie
            <select value={locatieId} onChange={(e) => setLocatieId(e.target.value)} style={inp}>
              {a.locaties.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
            </select>
          </label>
        )}
        {modus === 'ontvangst' && (
          <>
            <label style={lab}>Ontvangen op
              <input type="date" value={ontvangenOp} max={vandaag()} onChange={(e) => setOntvangenOp(e.target.value)} style={inp} />
            </label>
            <label style={lab}>THT{a.product.thtNodig ? ' *' : ' (optioneel)'}
              <input type="date" value={tht} min={ontvangenOp} onChange={(e) => setTht(e.target.value)} style={inp} />
            </label>
            <label style={lab}>Aankoopprijs € (zonder btw)
              <input value={aankoop} onChange={(e) => setAankoop(e.target.value)} inputMode="decimal" placeholder="optioneel" style={{ ...inp, width: 100 }} />
            </label>
          </>
        )}
        {modus === 'afboeken' && (
          <label style={lab}>Reden
            <select value={reden} onChange={(e) => setReden(e.target.value)} style={inp}>
              <option value="THT_VERLOPEN">THT verlopen (weggegooid)</option>
              <option value="BESCHADIGD">Beschadigd</option>
              <option value="ANDERE">Andere reden</option>
            </select>
          </label>
        )}
        <label style={{ ...lab, flex: '1 1 140px' }}>Opmerking
          <input value={opmerking} onChange={(e) => setOpmerking(e.target.value)} maxLength={200} placeholder="optioneel" style={{ ...inp, width: '100%' }} />
        </label>
        <button type="button" onClick={bewaar} disabled={bezig} style={btnBlauw}>
          {bezig ? 'Bezig…' : modus === 'ontvangst' ? 'Ontvangst bewaren' : modus === 'afboeken' ? 'Afboeken' : 'Telling bewaren'}
        </button>
        {modus === 'tellen' && <div style={{ width: '100%', fontSize: 12, color: '#6b7280' }}>Nu op {locNaam}: {hoeveelheid(huidig, eenheid)}. Wat je telt, wordt de voorraad; het verschil komt in het logboek.</div>}
      </div>
      {fout && <p style={{ color: 'crimson', margin: '8px 0' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', margin: '8px 0' }}>{melding}</p>}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '14px 0 6px' }}>
        <strong>{alles ? 'Alle ontvangsten' : 'Ontvangsten die er nog liggen'}</strong>
        <button type="button" onClick={() => setAlles(!alles)} style={linkKnop}>{alles ? 'enkel wat er nog ligt' : 'toon alle'}</button>
      </div>
      {loten.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 14 }}>{alles ? 'Nog geen ontvangsten geregistreerd.' : 'Geen ontvangsten meer in voorraad.'}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: 12, borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Ontvangen</th><th style={th}>Locatie</th><th style={{ ...th, textAlign: 'right' }}>Aantal</th><th style={th}>THT</th><th style={{ ...th, textAlign: 'right' }}>Nog aanwezig*</th><th style={th}>Door</th>
              </tr>
            </thead>
            <tbody>
              {loten.map((l) => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: l.rest > 0 ? 1 : 0.55 }}>
                  <td style={td}>{datumNl(l.ontvangenOp)}{l.bron === 'FACTUUR' ? <span style={{ color: '#6b7280', fontSize: 12 }}> · factuur</span> : null}</td>
                  <td style={td}>{l.locatie}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{hoeveelheid(l.aantal, eenheid)}</td>
                  <td style={td}>{l.tht ? <>{datumNl(l.tht)} <ThtLabel status={l.status} dagen={l.dagenTotTht} /></> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: l.rest > 0 ? 600 : 400 }}>{hoeveelheid(l.rest, eenheid)}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{l.door ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>* Geschat uit de actuele voorraad: wat het eerst vervalt, gaat eerst weg.</div>
        </div>
      )}

      {a.correcties.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Afboekingen en tellingen ({a.correcties.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14 }}>
            {a.correcties.map((c) => (
              <li key={c.id}>
                {new Date(c.op).toLocaleDateString('nl-BE')} · {REDEN[c.reden] ?? c.reden} · {c.aantal > 0 ? '+' : ''}{hoeveelheid(c.aantal, eenheid)} ({c.locatie}){c.door ? ` · ${c.door}` : ''}{c.opmerking ? ` · ${c.opmerking}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const tegel = (rood: boolean): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: 10, padding: '6px 12px', minWidth: 90, background: rood ? '#fef2f2' : '#fff', color: rood ? '#991b1b' : undefined });
const waarschuwing: CSSProperties = { background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '6px 10px', fontSize: 13, margin: '6px 0' };
const tab = (aan: boolean): CSSProperties => ({ padding: '6px 14px', borderRadius: 999, cursor: 'pointer', border: aan ? '2px solid #0d4589' : '1px solid #cbd5e1', background: aan ? '#eff6ff' : '#fff', fontWeight: aan ? 700 : 500 });
const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#6b7280' };
const inp: CSSProperties = { padding: 7, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box' };
const btnBlauw: CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const linkKnop: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#0d4589', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 };
const th: CSSProperties = { padding: '4px 6px' };
const td: CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
