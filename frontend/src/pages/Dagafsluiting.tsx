import { useEffect, useState, type CSSProperties } from 'react';
import {
  getDagoverzicht, dagAfsluiten, getAfsluitingen, getDagRapport, dagafsluitingCsvUrl,
  getMeta, updateOnderneming,
  type Dagrapport, type AfsluitingKort,
} from '../api/client';
import { getVerkoper } from '../auth';

const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);

// Nette naam van een betaalwijze op het dagafsluiting-ticket.
function betaalNaam(b?: string | null): string {
  switch (b) {
    case 'CASH': return 'Cash';
    case 'BANCONTACT': return 'Bancontact';
    case 'KAART': return 'Kaart';
    case 'OVERSCHRIJVING': return 'Overschrijving';
    case 'QR': return 'QR-code';
    case 'EIGEN_REKENING': return 'Eigen rekening';
    case 'ONLINE': return 'Online';
    default: return b ?? '—';
  }
}

// Dagontvangsten (Fase 2/wettelijk): toont de dagontvangsten van de winkel,
// gesplitst per BTW-tarief en betaalwijze, met de B2B-facturen apart. Sluit de
// dag af (onwijzigbaar, met volgnummer) en houdt een register bij.
export function Dagafsluiting() {
  const [rapport, setRapport] = useState<Dagrapport | null>(null);
  const [afgesloten, setAfgesloten] = useState(false);
  const [register, setRegister] = useState<AfsluitingKort[]>([]);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);
  // onderneming-gegevens voor op het ticket
  const [ond, setOnd] = useState({ naam: '', btwNummer: '', adres: '' });
  const [ondOpgeslagen, setOndOpgeslagen] = useState('');

  async function laad() {
    setFout('');
    try {
      setRapport(await getDagoverzicht());
      setAfgesloten(false);
      setRegister(await getAfsluitingen());
      const m = await getMeta();
      if (m.onderneming) setOnd({ naam: m.onderneming.naam, btwNummer: m.onderneming.btwNummer ?? '', adres: m.onderneming.adres ?? '' });
    } catch {
      setFout('Kon de gegevens niet laden.');
    }
  }
  useEffect(() => { laad(); }, []);

  async function bewaarOnderneming() {
    await updateOnderneming(ond);
    setOndOpgeslagen('Opgeslagen.');
    setTimeout(() => setOndOpgeslagen(''), 2000);
    if (!afgesloten) setRapport(await getDagoverzicht());
  }

  async function afsluiten() {
    if (!rapport || (rapport.dagontvangsten.aantal + rapport.facturen.length) === 0 || bezig) return;
    if (!window.confirm('De dag definitief afsluiten? De ontvangsten worden onwijzigbaar vastgelegd.')) return;
    setBezig(true); setFout('');
    try {
      const r = await dagAfsluiten(getVerkoper()?.id);
      setRapport(r); setAfgesloten(true);
      setRegister(await getAfsluitingen());
    } catch {
      setFout('Afsluiten mislukt.');
    } finally { setBezig(false); }
  }

  async function bekijk(id: string) {
    setRapport(await getDagRapport(id));
    setAfgesloten(true);
  }

  if (!rapport) return <div>{fout || 'Laden…'}</div>;
  const leeg = rapport.dagontvangsten.aantal + rapport.facturen.length === 0;

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {/* Links: onderneming, afsluiten, register */}
      <div style={{ flex: '1 1 360px', maxWidth: 460 }}>
        <h2>Dagontvangsten</h2>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Onderneming-gegevens (voor op het ticket)</summary>
          <div style={{ padding: '8px 0' }}>
            {!ond.btwNummer && <p style={{ color: '#92400e', fontSize: 13 }}>⚠ Vul het BTW-nummer in — verplicht op een wettelijk ticket.</p>}
            <input placeholder="Naam" value={ond.naam} onChange={(e) => setOnd({ ...ond, naam: e.target.value })} style={inp} />
            <input placeholder="BTW-nummer (BE0…)" value={ond.btwNummer} onChange={(e) => setOnd({ ...ond, btwNummer: e.target.value })} style={inp} />
            <input placeholder="Adres" value={ond.adres} onChange={(e) => setOnd({ ...ond, adres: e.target.value })} style={inp} />
            <button onClick={bewaarOnderneming} style={btnGrijs}>Opslaan</button>
            {ondOpgeslagen && <span style={{ color: '#16a34a', marginLeft: 8 }}>{ondOpgeslagen}</span>}
          </div>
        </details>

        {!afgesloten && (
          <button onClick={afsluiten} disabled={leeg || bezig}
            style={{ ...btnGroen, width: '100%', background: leeg || bezig ? '#9ca3af' : '#16a34a' }}>
            {bezig ? 'Bezig…' : 'Dag afsluiten'}
          </button>
        )}
        {afgesloten && (
          <button onClick={laad} style={{ ...btnGrijs, width: '100%' }}>← Terug naar vandaag</button>
        )}
        {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

        <h3 style={{ marginTop: 20 }}>Register</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
              <th style={{ padding: 4 }}>Nr</th><th style={{ padding: 4 }}>Datum</th>
              <th style={{ padding: 4, textAlign: 'right' }}>Totaal</th><th />
            </tr>
          </thead>
          <tbody>
            {register.map((a) => (
              <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: 4 }}>{a.volgnummer ?? '—'}</td>
                <td style={{ padding: 4 }}>{new Date(a.tot).toLocaleDateString('nl-BE')}</td>
                <td style={{ padding: 4, textAlign: 'right' }}>{euro(a.totaal)}</td>
                <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                  <button onClick={() => bekijk(a.id)} style={btnMini}>Bekijk</button>{' '}
                  <a href={dagafsluitingCsvUrl(a.id)} style={{ ...btnMini, textDecoration: 'none', color: '#2563eb' }}>CSV</a>
                </td>
              </tr>
            ))}
            {register.length === 0 && <tr><td colSpan={4} style={{ padding: 12, color: '#999' }}>Nog geen afsluitingen.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Rechts: het ticket */}
      <div style={{ flex: '1 1 360px', maxWidth: 420 }}>
        <Ticket rapport={rapport} afgesloten={afgesloten} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => window.print()} style={{ ...btnGrijs, flex: 1 }}>Afdrukken</button>
          {rapport.id && <a href={dagafsluitingCsvUrl(rapport.id)} style={{ ...btnGrijs, flex: 1, textAlign: 'center', textDecoration: 'none', color: '#111' }}>CSV-export</a>}
        </div>
      </div>
    </div>
  );
}

function Ticket({ rapport, afgesloten }: { rapport: Dagrapport; afgesloten: boolean }) {
  const d = rapport.dagontvangsten;
  return (
    <div className="dagticket" style={{ border: '1px solid #ddd', borderRadius: 10, padding: 18, fontFamily: 'ui-monospace,Consolas,monospace' }}>
      {/* Bij het afdrukken enkel dit ticket tonen — geen kassa-menu of schermknoppen. */}
      <style>{`
        @media print {
          nav { display: none !important; }
          body * { visibility: hidden !important; }
          .dagticket, .dagticket * { visibility: visible !important; }
          .dagticket { position: absolute; left: 0; top: 0; width: 100%; border: none !important; padding: 0 !important; }
        }
      `}</style>
      <div style={{ textAlign: 'center' }}>
        <strong>{rapport.onderneming?.naam ?? 'Onderneming'}</strong><br />
        {rapport.onderneming?.adres && <span style={{ fontSize: 12 }}>{rapport.onderneming.adres}<br /></span>}
        <span style={{ fontSize: 12 }}>
          {rapport.onderneming?.btwNummer ? `BTW ${rapport.onderneming.btwNummer}` : <em style={{ color: 'crimson' }}>BTW-nummer ontbreekt</em>}
          {rapport.onderneming?.ondernemingsnummer ? ` · ond.nr ${rapport.onderneming.ondernemingsnummer}` : ''}
        </span>
      </div>
      <hr />
      <div style={{ textAlign: 'center', fontWeight: 700 }}>
        DAGONTVANGSTEN {rapport.volgnummer != null ? `nr ${rapport.volgnummer}` : '(voorbeeld)'}
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: '#555' }}>
        {rapport.tot ? new Date(rapport.tot).toLocaleString('nl-BE') : ''}<br />
        {rapport.locatie}{rapport.verkoper ? ` · ${rapport.verkoper}` : ''}
      </div>
      <hr />

      <div style={{ fontWeight: 600, fontSize: 13 }}>BTW-uitsplitsing — {d.aantal} verkopen</div>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#666', fontSize: 11 }}>
            <th style={{ textAlign: 'left' }}></th>
            <th style={{ textAlign: 'right' }}>maatstaf</th>
            <th style={{ textAlign: 'right' }}>btw</th>
            <th style={{ textAlign: 'right' }}>incl.</th>
          </tr>
        </thead>
        <tbody>
          {d.perBtwTarief.map((b) => (
            <tr key={b.percentage}>
              <td>BTW {b.percentage}%</td>
              <td style={{ textAlign: 'right' }}>{euro(b.maatstaf)}</td>
              <td style={{ textAlign: 'right' }}>{euro(b.btw)}</td>
              <td style={{ textAlign: 'right' }}>{euro(b.maatstaf + b.btw)}</td>
            </tr>
          ))}
          {d.perBtwTarief.length === 0 && <tr><td colSpan={4} style={{ color: '#999' }}>—</td></tr>}
          <tr style={{ fontWeight: 700, borderTop: '1px solid #999' }}>
            <td>Totaal</td>
            <td style={{ textAlign: 'right' }}>{euro(d.totaalExcl)}</td>
            <td style={{ textAlign: 'right' }}>{euro(d.totaalBtw)}</td>
            <td style={{ textAlign: 'right' }}>{euro(d.totaalExcl + d.totaalBtw)}</td>
          </tr>
        </tbody>
      </table>

      {d.perCategorie.length > 0 && (
        <>
          <hr />
          <div style={{ fontWeight: 600, fontSize: 13 }}>Per categorie</div>
          {d.perCategorie.map((c) => (
            <div key={c.categorie} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>{c.categorie}</span><span>{euro(c.omzetIncl)}</span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
        {Object.entries(d.perBetaalwijze).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{betaalNaam(k)}</span><span>{euro(v)}</span></div>
        ))}
      </div>

      {rapport.eigenGebruik && rapport.eigenGebruik.aantal > 0 && (
        <div style={{ fontSize: 12, color: '#555', marginTop: 6, borderTop: '1px dashed #ccc', paddingTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontStyle: 'italic' }}>
            <span>Eigen rekening ({rapport.eigenGebruik.aantal}) — niet in de omzet</span>
            <span>{euro(rapport.eigenGebruik.incl)}</span>
          </div>
        </div>
      )}

      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}>
        <span>TOTAAL</span><span>{euro(d.totaalIncl)}</span>
      </div>
      <div style={{ fontSize: 11, color: '#777', marginTop: 8, textAlign: 'center' }}>
        {afgesloten ? 'Onwijzigbaar bewaard — bewaarplicht 7 jaar.' : 'Voorbeeld — nog niet afgesloten.'}
      </div>
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const btnGroen: CSSProperties = { padding: 12, border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const btnGrijs: CSSProperties = { padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const btnMini: CSSProperties = { padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 };
