import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  getVerkopen, getTicket, annuleerVerkoop, wijzigVerkoopBetaalwijze, verwijderVerkoop,
  type VerkoopKort, type Ticket, type Betaalwijze,
} from '../api/client';
import { TicketWeergave } from './Kassa';

const euro = (n: number) => '€ ' + n.toFixed(2);
const vandaag = () => new Date().toISOString().slice(0, 10);

// Nette naam van een betaalwijze.
function betaalNaam(b?: string | null): string {
  switch (b) {
    case 'CASH': return 'Cash';
    case 'BANCONTACT': return 'Bancontact';
    case 'KAART': return 'Kaart';
    case 'OVERSCHRIJVING': return 'Overschrijving';
    case 'QR': return 'QR-code';
    case 'EIGEN_REKENING': return 'Eigen rekening';
    case 'ONLINE': return 'Online';
    default: return b ?? '-';
  }
}
// Betaalwijzen die je aan de kassa kan kiezen (voor het wijzigen).
const BETAALWIJZEN: Betaalwijze[] = ['CASH', 'BANCONTACT', 'KAART', 'OVERSCHRIJVING', 'QR', 'CADEAUBON', 'EIGEN_REKENING'];

// Terugvinden van eerdere verkopen: ticket herafdrukken, en (voor beheerders)
// een verkoop annuleren of de betaalwijze corrigeren.
export function Verkopen() {
  const [datum, setDatum] = useState(vandaag());
  const [lijst, setLijst] = useState<VerkoopKort[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [fout, setFout] = useState('');
  const [betaalRij, setBetaalRij] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  // De "Verwijderen"-knop is verborgen tot de sneltoetsreeks "D", "+", "Enter"
  // na elkaar wordt ingedrukt. Daarna blijft hij zichtbaar zolang dit scherm
  // openstaat (bij het verlaten van het tabblad wordt de component ontladen en
  // reset dit vanzelf).
  const [toonVerwijder, setToonVerwijder] = useState(false);
  const stap = useRef(0); // 0 = wacht op D, 1 = D gehad (wacht op +), 2 = + gehad (wacht op Enter)
  useEffect(() => {
    function opToets(e: KeyboardEvent) {
      console.log('[verwijder-sneltoets]', 'key=', e.key, 'code=', e.code, 'stap=', stap.current);
      const doel = e.target as HTMLElement | null;
      const tag = doel?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // niet tijdens typen
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // modifiers breken de reeks niet af
      // "+" komt afhankelijk van toetsenbord/lay-out binnen als '+', '=' (Shift+=),
      // of via de code Equal/NumpadAdd — we aanvaarden ze allemaal.
      const isPlus = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal';
      if (stap.current === 0 && (e.key === 'd' || e.key === 'D')) { stap.current = 1; return; }
      if (stap.current === 1 && isPlus) { stap.current = 2; return; }
      if (stap.current === 2 && e.key === 'Enter') { setToonVerwijder(true); stap.current = 0; return; }
      stap.current = 0; // elke andere toets begint de reeks opnieuw
    }
    window.addEventListener('keydown', opToets);
    return () => window.removeEventListener('keydown', opToets);
  }, []);

  async function laad() {
    setFout('');
    try { setLijst(await getVerkopen(datum || undefined)); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
  }
  useEffect(() => { laad(); }, [datum]);

  async function herafdruk(id: string) {
    setFout('');
    try { setTicket(await getTicket(id)); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Ticket ophalen mislukt'); }
  }

  async function annuleer(v: VerkoopKort) {
    if (!window.confirm(`Verkoop van ${euro(v.totaal)} annuleren?\n\nDe verkoop telt dan niet meer mee in de dagafsluiting en de voorraad wordt teruggeboekt.`)) return;
    const reden = window.prompt('Reden van de annulatie (optioneel):', '') ?? undefined;
    setBezig(true); setFout('');
    try { await annuleerVerkoop(v.id, reden || undefined); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Annuleren mislukt'); }
    finally { setBezig(false); }
  }

  // Verkoop definitief verwijderen (harde delete). Enkel de beheerder, met wachtwoord.
  async function verwijder(v: VerkoopKort) {
    const waarschuwing = v.afgesloten
      ? '\n\n⚠ Deze verkoop zit in een AFGESLOTEN dagafsluiting (reeds officieel geregistreerd). Het bewaarde dagafsluitingsrapport blijft ongewijzigd, maar de verkoop zelf verdwijnt.'
      : '';
    if (!window.confirm(
      `Verkoop van ${euro(v.totaal)} DEFINITIEF verwijderen?\n\n` +
      'Dit kan niet ongedaan gemaakt worden.' + waarschuwing + '\n\n' +
      'Heb je deze wijziging ook in Scrada doorgevoerd? Klik OK om te bevestigen.',
    )) return;
    const wachtwoord = window.prompt('Beheerderswachtwoord om het verwijderen te bevestigen:');
    if (!wachtwoord) return;
    setBezig(true); setFout('');
    try { await verwijderVerkoop(v.id, wachtwoord); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Verwijderen mislukt'); }
    finally { setBezig(false); }
  }

  async function zetBetaalwijze(v: VerkoopKort, bw: Betaalwijze) {
    if (bw === v.betaalwijze) { setBetaalRij(null); return; }
    const waarschuwing = v.afgesloten ? '\n\n⚠ Deze verkoop zit in een AFGESLOTEN dagafsluiting (reeds geregistreerd).' : '';
    if (!window.confirm(
      `Betaalwijze wijzigen naar "${betaalNaam(bw)}".${waarschuwing}\n\n` +
      'Heb je deze wijziging ook in Scrada doorgevoerd? Klik OK om te bevestigen.',
    )) { setBetaalRij(null); return; }
    const wachtwoord = window.prompt('Beheerderswachtwoord om de wijziging te bevestigen:');
    if (!wachtwoord) { setBetaalRij(null); return; }
    setBezig(true); setFout('');
    try { await wijzigVerkoopBetaalwijze(v.id, bw, wachtwoord); setBetaalRij(null); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Wijzigen mislukt'); }
    finally { setBezig(false); }
  }

  if (ticket) {
    return <TicketWeergave ticket={ticket} onNieuw={() => setTicket(null)} nieuwLabel="← Terug naar de lijst" />;
  }

  return (
    <div style={{ maxWidth: 920 }}>
      <h2>Verkopen</h2>
      <p style={{ color: '#6b7280', marginTop: 4 }}>
        Vind een eerdere verkoop terug, druk het ticket opnieuw af, annuleer een verkoop of corrigeer de betaalwijze.
        Een verkoop in een afgesloten dagafsluiting (🔒) kan enkel de beheerder nog corrigeren (met wachtwoord) — pas de wijziging dan ook in Scrada aan.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0' }}>
        <label style={{ fontSize: 13, color: '#6b7280' }}>Dag</label>
        <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} style={inp} />
        <button onClick={() => setDatum('')} style={btnGrijs}>Alle</button>
        <button onClick={() => setDatum(vandaag())} style={btnGrijs}>Vandaag</button>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: 6 }}>Tijdstip</th>
            <th style={{ padding: 6 }}>Kanaal</th>
            <th style={{ padding: 6 }}>Betaal</th>
            <th style={{ padding: 6 }}>Verkoper</th>
            <th style={{ padding: 6, textAlign: 'right' }}>Artikels</th>
            <th style={{ padding: 6, textAlign: 'right' }}>Totaal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lijst.map((v) => {
            const vergrendeld = v.afgesloten; // in een afgesloten dagafsluiting → niet meer wijzigbaar
            return (
            <tr key={v.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: v.geannuleerd ? 0.5 : 1, background: v.geannuleerd ? '#fef2f2' : undefined }}>
              <td style={{ padding: 6 }}>
                {new Date(v.datum).toLocaleString('nl-BE')}
                {v.geannuleerd && <span style={{ marginLeft: 6, color: '#b91c1c', fontWeight: 700, fontSize: 12 }}>GEANNULEERD</span>}
              </td>
              <td style={{ padding: 6 }}>{v.kanaal === 'WEBSHOP' ? 'Webshop' : 'Kassa'}</td>
              <td style={{ padding: 6 }}>
                {betaalRij === v.id ? (
                  <select autoFocus value={v.betaalwijze ?? ''} disabled={bezig}
                    onChange={(e) => zetBetaalwijze(v, e.target.value as Betaalwijze)}
                    onBlur={() => setBetaalRij(null)} style={{ ...inp, padding: 4 }}>
                    {BETAALWIJZEN.map((b) => <option key={b} value={b}>{betaalNaam(b)}</option>)}
                  </select>
                ) : (
                  <span style={{ textDecoration: v.geannuleerd ? 'line-through' : 'none' }}>{betaalNaam(v.betaalwijze)}</span>
                )}
              </td>
              <td style={{ padding: 6 }}>{v.verkoper ?? '-'}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{v.aantalLijnen}</td>
              <td style={{ padding: 6, textAlign: 'right', fontWeight: 600, textDecoration: v.geannuleerd ? 'line-through' : 'none' }}>{euro(v.totaal)}</td>
              <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button onClick={() => herafdruk(v.id)} style={btnBlauw}>Herafdrukken</button>
                {!v.geannuleerd && v.kanaal !== 'WEBSHOP' && (
                  <>
                    <button onClick={() => setBetaalRij(betaalRij === v.id ? null : v.id)} disabled={bezig} style={btnGrijsMini}>Betaalwijze</button>
                    {vergrendeld
                      ? <span title="Afgesloten dagafsluiting — enkel de beheerder kan de betaalwijze nog corrigeren (met wachtwoord, en ook in Scrada)" style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af' }}>🔒</span>
                      : <button onClick={() => annuleer(v)} disabled={bezig} style={btnRood}>Annuleren</button>}
                  </>
                )}
                {toonVerwijder && (
                  <button onClick={() => verwijder(v)} disabled={bezig} title="Verkoop definitief verwijderen (enkel beheerder, met wachtwoord)" style={btnVerwijder}>Verwijderen</button>
                )}
              </td>
            </tr>
            );
          })}
          {lijst.length === 0 && <tr><td colSpan={7} style={{ padding: 16, color: '#999' }}>Geen verkopen voor deze selectie.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const btnGrijs: CSSProperties = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnGrijsMini: CSSProperties = { marginLeft: 8, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnBlauw: CSSProperties = { padding: '6px 12px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const btnRood: CSSProperties = { marginLeft: 8, padding: '6px 10px', border: '1px solid #b91c1c', borderRadius: 6, background: '#fff', color: '#b91c1c', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const btnVerwijder: CSSProperties = { marginLeft: 8, padding: '6px 10px', border: 'none', borderRadius: 6, background: '#b91c1c', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
