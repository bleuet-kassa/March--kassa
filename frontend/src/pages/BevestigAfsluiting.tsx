import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import {
  getAfsluitAanvraag, bevestigAfsluitAanvraag, weigerAfsluitAanvraag,
  type AfsluitAanvraag, type Dagrapport,
} from '../api/client';

const euro = (n: number) => '€ ' + Number(n).toFixed(2);
const NAMEN: Record<string, string> = {
  CASH: 'Cash', BANCONTACT: 'Bancontact', KAART: 'Kaart', OVERSCHRIJVING: 'Overschrijving', QR: 'QR-code',
  CADEAUBON: 'Cadeaubon', EIGEN_REKENING: 'Eigen rekening', OP_REKENING: 'Op rekening', ONBEKEND: 'Op rekening', ONLINE: 'Online',
};
const betaalNaam = (b: string) => NAMEN[b] ?? b;

type Data = AfsluitAanvraag & { rapport: Dagrapport | null };

// Bevestigpagina op de telefoon van de beheerder: geopend via de geheime link
// uit de pushmelding. Toont het dagoverzicht en registreert de dagafsluiting
// pas na een uitdrukkelijke bevestiging. Mobile-first (één kolom, grote knoppen).
export function BevestigAfsluiting() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);
  const [klaar, setKlaar] = useState(false);

  useEffect(() => {
    getAfsluitAanvraag(token).then(setData).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'));
  }, [token]);

  async function bevestig() {
    if (!window.confirm('De dag definitief afsluiten en de ontvangsten registreren?')) return;
    setBezig(true); setFout('');
    try {
      const r = await bevestigAfsluitAanvraag(token);
      setData({ ...r, rapport: r.rapport });
      setKlaar(true);
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bevestigen mislukt'); }
    finally { setBezig(false); }
  }

  async function weiger() {
    if (!window.confirm('Deze aanvraag weigeren? De kassa kan later een nieuwe aanvraag sturen.')) return;
    setBezig(true); setFout('');
    try { const r = await weigerAfsluitAanvraag(token); setData({ ...r, rapport: null }); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Weigeren mislukt'); }
    finally { setBezig(false); }
  }

  const status = data?.status;
  const open = status === 'OPEN';
  const rapport = data?.rapport ?? null;
  const perBw = rapport ? Object.entries(rapport.dagontvangsten.perBetaalwijze ?? {}) : [];

  return (
    <div style={pagina}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '.03em' }}>Marché</div>
        <div style={{ color: '#6b7280', fontSize: 13, letterSpacing: '.1em' }}>DAGAFSLUITING BEVESTIGEN</div>
      </div>

      {fout && <div style={{ ...kader, background: '#fef2f2', borderColor: '#fca5a5', color: '#b91c1c' }}>{fout}</div>}
      {!data && !fout && <div style={{ color: '#6b7280', textAlign: 'center' }}>Laden…</div>}

      {data && (
        <>
          <div style={kader}>
            <div style={rij}><span>Status</span><strong style={{ color: open ? '#b45309' : status === 'BEVESTIGD' ? '#166534' : '#6b7280' }}>{statusTekst(status ?? '')}</strong></div>
            <div style={rij}><span>Aangevraagd door</span><span>{data.aangevraagdDoor ?? 'de kassa'}</span></div>
            <div style={rij}><span>Om</span><span>{new Date(data.aangevraagdOp).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
            <div style={{ ...rij, borderTop: '1px solid #e5e7eb', marginTop: 8, paddingTop: 10, fontSize: 20 }}>
              <span>Dagtotaal</span><strong>{euro(rapport ? rapport.algemeenTotaalIncl : data.totaal)}</strong>
            </div>
            <div style={{ ...rij, color: '#6b7280', fontSize: 13 }}>
              <span>Verkopen</span><span>{rapport ? rapport.dagontvangsten.aantal + rapport.facturen.length : data.aantalVerkopen}</span>
            </div>
          </div>

          {rapport && perBw.length > 0 && (
            <div style={kader}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Per betaalwijze</div>
              {perBw.map(([bw, bedrag]) => (
                <div key={bw} style={rij}><span>{betaalNaam(bw)}</span><span>{euro(Number(bedrag))}</span></div>
              ))}
            </div>
          )}

          {klaar && (
            <div style={{ ...kader, background: '#f0fdf4', borderColor: '#86efac', color: '#166534', textAlign: 'center', fontWeight: 700 }}>
              ✔ De dag is afgesloten en geregistreerd. Je kan deze pagina sluiten.
            </div>
          )}

          {open && !klaar && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <button onClick={bevestig} disabled={bezig} style={knopGroen}>{bezig ? 'Bezig…' : '✔ Dag afsluiten en registreren'}</button>
              <button onClick={weiger} disabled={bezig} style={knopGrijs}>✖ Weigeren</button>
              <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
                Geldig tot {new Date(data.verlooptOp).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}. De ontvangsten worden pas bij bevestiging onwijzigbaar vastgelegd.
              </div>
            </div>
          )}

          {!open && !klaar && (
            <div style={{ ...kader, textAlign: 'center', color: '#6b7280' }}>
              {status === 'BEVESTIGD' && 'Deze aanvraag is al bevestigd; de dag is geregistreerd.'}
              {status === 'GEWEIGERD' && 'Deze aanvraag werd geweigerd. De kassa kan een nieuwe aanvraag sturen.'}
              {status === 'VERLOPEN' && 'Deze aanvraag is verlopen. Vraag aan de kassa een nieuwe aanvraag.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function statusTekst(s: string) {
  switch (s) {
    case 'OPEN': return 'Wacht op je bevestiging';
    case 'BEVESTIGD': return 'Bevestigd';
    case 'GEWEIGERD': return 'Geweigerd';
    case 'VERLOPEN': return 'Verlopen';
    default: return s;
  }
}

const pagina: CSSProperties = { maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', fontSize: 16 };
const kader: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 12, background: '#fff' };
const rij: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' };
const knopGroen: CSSProperties = { padding: 18, fontSize: 18, fontWeight: 800, borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer' };
const knopGrijs: CSSProperties = { padding: 14, fontSize: 16, fontWeight: 600, borderRadius: 12, border: '1px solid #cbd5e1', background: '#fff', color: '#374151', cursor: 'pointer' };
