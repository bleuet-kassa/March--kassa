import { useEffect, useState, type CSSProperties } from 'react';
import { getOndernemingen, updateOndernemingById, getPushStatus, stuurPushTest, type Onderneming } from '../api/client';
import { pushOndersteund, staatOpBeginscherm, huidigAbonnement, schakelMeldingenIn, schakelMeldingenUit } from '../push';

// Instellingen: ondernemingsgegevens die op de documenten (dagontvangsten-ticket,
// facturen, Scrada) moeten staan. Per entiteit (winkel + import-onderneming).
export function Instellingen() {
  const [lijst, setLijst] = useState<Onderneming[]>([]);
  const [melding, setMelding] = useState('');

  async function laad() { setLijst(await getOndernemingen()); }
  useEffect(() => { laad(); }, []);

  return (
    <div style={{ maxWidth: 640 }}>
      <PushInstellingen />
      <h2>Instellingen — ondernemingen</h2>
      <p style={{ color: '#6b7280', fontSize: 14 }}>
        Deze gegevens verschijnen op je documenten (dagontvangsten-ticket, facturen, Scrada).
      </p>
      {melding && <p style={{ color: '#16a34a', fontWeight: 600 }}>{melding}</p>}
      {lijst.map((o) => (
        <OndernemingKaart key={o.id} onderneming={o} onOpgeslagen={() => { setMelding('Opgeslagen.'); setTimeout(() => setMelding(''), 2000); laad(); }} />
      ))}
      {lijst.length === 0 && <p style={{ color: '#999' }}>Laden…</p>}
    </div>
  );
}

// Pushmeldingen op de telefoon van de beheerder (o.a. "dagafsluiting bevestigen").
// In te schakelen per toestel; op iPhone enkel als de kassa op het beginscherm staat.
function PushInstellingen() {
  const ondersteund = pushOndersteund();
  const [aan, setAan] = useState(false);
  const [status, setStatus] = useState<{ mijnToestellen: number; totaal: number } | null>(null);
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const beginscherm = staatOpBeginscherm();

  async function laad() {
    try { setAan(!!(await huidigAbonnement())); } catch { setAan(false); }
    try { setStatus(await getPushStatus()); } catch { /* geen status beschikbaar */ }
  }
  useEffect(() => { laad(); }, []);

  async function inschakelen() {
    setBezig(true); setMelding('');
    try {
      const r = await schakelMeldingenIn();
      if (r === 'ok') setMelding('✔ Meldingen ingeschakeld op dit toestel.');
      else if (r === 'geweigerd') setMelding('Meldingen geweigerd — sta ze toe in de browser-/telefooninstellingen en probeer opnieuw.');
      else setMelding('Deze browser ondersteunt geen pushmeldingen.' + (ios ? ' Op iPhone: open de kassa in Safari, tik op Deel → "Zet op beginscherm", en open ze vanaf dat icoon.' : ''));
      await laad();
    } catch (e) { setMelding(e instanceof Error ? e.message : 'Inschakelen mislukt'); }
    finally { setBezig(false); }
  }
  async function uitschakelen() {
    setBezig(true); setMelding('');
    try { await schakelMeldingenUit(); setMelding('Meldingen uitgeschakeld op dit toestel.'); await laad(); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Uitschakelen mislukt'); }
    finally { setBezig(false); }
  }
  async function test() {
    setBezig(true); setMelding('');
    try { const r = await stuurPushTest(); setMelding(`Testmelding verstuurd naar ${r.verstuurd} van ${r.toestellen} toestel(len).`); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Test mislukt'); }
    finally { setBezig(false); }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>Meldingen op je telefoon</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
        Schakel dit in <strong>op je smartphone</strong>: je krijgt dan een pushmelding wanneer de kassa de dagafsluiting aanvraagt, en je bevestigt met één tik.
      </p>
      {ios && !beginscherm && (
        <p style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
          Op iPhone werkt dit enkel als de kassa op het beginscherm staat: open deze pagina in Safari, tik op <strong>Deel</strong> → <strong>Zet op beginscherm</strong>, en open de kassa vanaf dat icoon.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!aan
          ? <button onClick={inschakelen} disabled={bezig || !ondersteund} style={pushKnopPrimair}>Meldingen inschakelen op dit toestel</button>
          : <button onClick={uitschakelen} disabled={bezig} style={pushKnopSec}>Meldingen uitschakelen op dit toestel</button>}
        <button onClick={test} disabled={bezig} style={pushKnopSec}>Testmelding sturen</button>
        {status && <span style={{ color: '#6b7280', fontSize: 13 }}>Dit account: {status.mijnToestellen} toestel(len) · alle beheerders: {status.totaal}</span>}
      </div>
      {melding && <p style={{ marginTop: 10, fontWeight: 600 }}>{melding}</p>}
    </div>
  );
}
const pushKnopPrimair: CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 8, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const pushKnopSec: CSSProperties = { padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };

function OndernemingKaart({ onderneming, onOpgeslagen }: { onderneming: Onderneming; onOpgeslagen: () => void }) {
  const [naam, setNaam] = useState(onderneming.naam);
  const [nr, setNr] = useState(onderneming.ondernemingsnummer);
  const [btw, setBtw] = useState(onderneming.btwNummer ?? '');
  const [adres, setAdres] = useState(onderneming.adres ?? '');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  async function opslaan() {
    setFout(''); setBezig(true);
    try {
      await updateOndernemingById(onderneming.id, { naam, ondernemingsnummer: nr, btwNummer: btw, adres });
      onOpgeslagen();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Opslaan mislukt');
    } finally { setBezig(false); }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        {onderneming.isImporteur ? 'Import-onderneming' : 'Winkel'}
      </div>
      <label style={muted}>Naam</label>
      <input value={naam} onChange={(e) => setNaam(e.target.value)} style={inp} />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={muted}>Ondernemingsnummer</label>
          <input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="0801.311.258" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={muted}>BTW-nummer</label>
          <input value={btw} onChange={(e) => setBtw(e.target.value)} placeholder="BE0801311258" style={inp} />
        </div>
      </div>
      <label style={muted}>Adres</label>
      <input value={adres} onChange={(e) => setAdres(e.target.value)} placeholder="Straat 1, 9680 Maarkedal" style={inp} />
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      <button onClick={opslaan} disabled={bezig} style={btn}>{bezig ? 'Bezig…' : 'Opslaan'}</button>
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btn: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
