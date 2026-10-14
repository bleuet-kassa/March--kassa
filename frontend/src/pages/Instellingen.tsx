import { useEffect, useState, type CSSProperties } from 'react';
import { getOndernemingen, updateOndernemingById, getPushStatus, stuurPushTest, type Onderneming, getSpreuken, voegSpreukToe, zetSpreukActief, verwijderSpreuk, vulSpreukenAan, type Spreuk } from '../api/client';
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
      <SpreukenBeheer />
    </div>
  );
}

// Spreuk van de dag op het startscherm van de kassa: lijst beheren; wekelijks
// automatisch aangevuld door Claude (zelfde sleutel als "Facturen inlezen").
function SpreukenBeheer() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getSpreuken>> | null>(null);
  const [tekst, setTekst] = useState('');
  const [auteur, setAuteur] = useState('Marché');
  const [emoji, setEmoji] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [toonAlle, setToonAlle] = useState(false);

  async function laad() { try { setData(await getSpreuken()); } catch { /* geen toegang */ } }
  useEffect(() => { laad(); }, []);

  async function doe(actie: () => Promise<unknown>, tekstOk?: string) {
    setBezig(true); setMelding('');
    try { await actie(); if (tekstOk) setMelding(tekstOk); await laad(); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Mislukt'); }
    finally { setBezig(false); }
  }
  if (!data) return null;
  const actief = data.spreuken.filter((s) => s.actief).length;
  const zichtbaar = toonAlle ? data.spreuken : data.spreuken.slice(0, 15);

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>Spreuk van de dag</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
        Het startscherm van de kassa toont elke dag een andere spreuk ({actief} actief, {data.spreuken.length} in totaal).
        {data.aiBeschikbaar
          ? <> De lijst wordt automatisch aangevuld: {data.planning}.{data.laatsteAanvulling ? ` Laatste keer: ${new Date(data.laatsteAanvulling.datum + 'T12:00:00').toLocaleDateString('nl-BE')} (${data.laatsteAanvulling.toegevoegd} nieuwe, ${data.laatsteAanvulling.door}).` : ' Nog geen automatische aanvulling gebeurd.'}</>
          : <span style={{ color: '#b45309' }}> Automatisch aanvullen staat uit: er is geen ANTHROPIC_API_KEY ingesteld op Render.</span>}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input value={tekst} onChange={(e) => setTekst(e.target.value)} placeholder="Nieuwe spreuk…" style={{ ...inp, flex: '1 1 260px', marginBottom: 0 }} />
        <input value={auteur} onChange={(e) => setAuteur(e.target.value)} placeholder="Auteur" style={{ ...inp, width: 140, marginBottom: 0 }} />
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="Emoji" style={{ ...inp, width: 70, marginBottom: 0, textAlign: 'center' }} />
        <button onClick={() => doe(async () => { await voegSpreukToe({ tekst, auteur, emoji }); setTekst(''); setEmoji(''); }, 'Spreuk toegevoegd.')} disabled={bezig || tekst.trim().length < 5} style={btn}>Toevoegen</button>
        <button onClick={() => doe(async () => { const r = await vulSpreukenAan(7); setMelding(`${r.toegevoegd} nieuwe spreuken toegevoegd.`); })} disabled={bezig || !data.aiBeschikbaar} title="Laat Claude nu 7 nieuwe spreuken schrijven" style={{ ...btn, background: '#0d4589' }}>{bezig ? 'Bezig…' : '✨ Nu 7 nieuwe laten maken'}</button>
      </div>
      {melding && <p style={{ fontWeight: 600, margin: '0 0 8px' }}>{melding}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          {zichtbaar.map((s: Spreuk) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: s.actief ? 1 : .5 }}>
              <td style={{ padding: '6px 4px', width: 30, fontSize: 18 }}>{s.emoji ?? ''}</td>
              <td style={{ padding: '6px 4px' }}>{s.tekst}<span style={{ color: '#6b7280', fontSize: 12 }}> — {s.auteur ?? 'Marché'} · {s.bron === 'AI' ? 'automatisch' : s.bron === 'SEED' ? 'startreeks' : 'manueel'}</span></td>
              <td style={{ padding: '6px 4px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button onClick={() => doe(() => zetSpreukActief(s.id, !s.actief))} disabled={bezig} style={pushKnopSec}>{s.actief ? 'Uitzetten' : 'Aanzetten'}</button>{' '}
                <button onClick={() => { if (window.confirm('Deze spreuk verwijderen?')) doe(() => verwijderSpreuk(s.id)); }} disabled={bezig} style={{ ...pushKnopSec, color: 'crimson' }}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.spreuken.length > 15 && <button onClick={() => setToonAlle(!toonAlle)} style={{ ...pushKnopSec, marginTop: 8 }}>{toonAlle ? 'Minder tonen' : `Alle ${data.spreuken.length} tonen`}</button>}
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
