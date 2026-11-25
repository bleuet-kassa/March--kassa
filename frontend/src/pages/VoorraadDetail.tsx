import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  getVoorraadArtikel, voorraadOntvangen, voorraadAfboeken, voorraadTellen, zetThtNodig, wijzigOntvangst, annuleerOntvangst,
  type VoorraadArtikel, type VoorraadLot, type ThtStatus, type ApiFout,
} from '../api/client';
import { getVerkoper } from '../auth';
import { isAdminRol } from '../rechten';

const vandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
export const datumNl = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
export const hoeveelheid = (n: number, eenheid: string) =>
  eenheid === 'KG' ? `${n.toLocaleString('nl-BE', { maximumFractionDigits: 3 })} kg` : n.toLocaleString('nl-BE', { maximumFractionDigits: 3 });
const euroNl = (n: number | null) => (n == null ? '—' : '€ ' + n.toFixed(2).replace('.', ','));
const getal = (s: string) => Number(s.replace(',', '.'));
const REDEN: Record<string, string> = {
  THT_VERLOPEN: 'THT verlopen', BESCHADIGD: 'Beschadigd', ANDERE: 'Andere reden', TELLING: 'Telling',
  ONTVANGST_GEWIJZIGD: 'Ontvangst aangepast', ONTVANGST_GEANNULEERD: 'Ontvangst geannuleerd',
};
type Modus = 'ontvangst' | 'bestaand' | 'afboeken' | 'tellen';
type Bewerk = { id: string; tht: string; ontvangenOp: string; opmerking: string; bestaand: boolean };

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

// Voorraad van één artikel: stand per locatie, ontvangen (met datum en THT), de THT registreren van
// wat er al ligt, afboeken, tellen, de ontvangsten met wat er nog van ligt (aan te passen of, door
// een beheerder, te annuleren) en het logboek. Op de productfiche en in Voorraad.
export function VoorraadDetail({ productId, onGewijzigd, metThtSchakelaar = true }: { productId: string; onGewijzigd?: (a: VoorraadArtikel) => void; metThtSchakelaar?: boolean }) {
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
  // "Klopt die THT?": de server vond de THT ongewoon laat; na bevestiging opnieuw versturen (met
  // wat er dan in de velden staat; wie de THT nog aanpast, krijgt de vraag niet meer te zien).
  const [bevestig, setBevestig] = useState<{ tekst: string; wat: 'invoer' | 'lot' } | null>(null);
  const [bewerk, setBewerk] = useState<Bewerk | null>(null);
  const [teAnnuleren, setTeAnnuleren] = useState<string | null>(null);
  // De locatie van vóór "THT van wat er ligt" (die kiest zelf een locatie): terug bij het verlaten.
  const [voorBestaand, setVoorBestaand] = useState<string | null>(null);
  const isAdmin = isAdminRol(getVerkoper()?.rol ?? '');

  useEffect(() => {
    setA(null); setFout(''); setMelding(''); setBevestig(null); setBewerk(null); setTeAnnuleren(null);
    getVoorraadArtikel(productId)
      .then((x) => { setA(x); setLocatieId(x.locaties.find((l) => l.type === 'WINKEL')?.id ?? x.locaties[0]?.id ?? ''); })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Voorraad laden mislukt'));
  }, [productId]);

  // Nieuwe stand tonen (na ontvangen, afboeken, tellen, of een ontvangst aanpassen/annuleren).
  function ververs(x: VoorraadArtikel, tekst: string) {
    setA(x); setMelding(tekst); setBevestig(null);
    onGewijzigd?.(x); // bv. de productfiche neemt een nieuwe aankoop-/verkoopprijs over
    window.dispatchEvent(new Event('voorraad-gewijzigd')); // het belletje in de menubalk ververst
  }
  // Na het bewaren van het invoervak: ook dat vak leegmaken.
  function gewijzigd(x: VoorraadArtikel, tekst: string) {
    ververs(x, tekst);
    setAantal(''); setTht(''); setAankoop(''); setOpmerking('');
  }
  // Na een aanpassing aan een ontvangst blijft wat in het invoervak staat; in "THT van wat er ligt"
  // nooit meer dan er nu nog zonder THT ligt.
  function verversNaLot(x: VoorraadArtikel, tekst: string) {
    ververs(x, tekst);
    if (modus === 'bestaand') {
      const rest = x.locaties.find((l) => l.id === locatieId)?.zonderTht ?? 0;
      if (getal(aantal) > rest) setAantal(rest > 0 ? String(rest).replace('.', ',') : '');
    }
  }

  function toonFout(e: unknown, wat: 'invoer' | 'lot') {
    const f = e as ApiFout;
    if (f?.code === 'THT_BEVESTIGEN') setBevestig({ tekst: f.message, wat });
    else setFout(e instanceof Error ? e.message : 'Bewaren mislukt');
  }

  // Elke modus heeft een eigen betekenis voor het aantal (ontvangen, zonder THT, afgeboekt, geteld):
  // bij wisselen begint het vak leeg, zodat een getal nooit ongemerkt in een andere modus belandt.
  function kiesModus(m: Modus) {
    setFout(''); setMelding(''); setBevestig(null);
    if (m === modus) return;
    setModus(m);
    setAantal('');
    if (m === 'bestaand' && a) {
      // Waar ligt er iets zonder THT? Liefst de gekozen locatie, anders waar het meest ligt.
      setVoorBestaand(locatieId);
      const hier = a.locaties.find((l) => l.id === locatieId && l.zonderTht > 0);
      const l = hier ?? [...a.locaties].sort((x, y) => y.zonderTht - x.zonderTht)[0];
      if (l && l.zonderTht > 0) { setLocatieId(l.id); setAantal(String(l.zonderTht).replace('.', ',')); }
    } else if (modus === 'bestaand' && voorBestaand) {
      setLocatieId(voorBestaand); // de automatische locatiekeuze terugdraaien
      setVoorBestaand(null);
    }
  }

  async function bewaar(thtBevestigd = false) {
    setFout(''); setMelding(''); setBevestig(null);
    if (!aantal.trim()) { setFout(modus === 'tellen' ? 'Geef het getelde aantal.' : 'Geef het aantal.'); return; }
    setBezig(true);
    try {
      if (modus === 'ontvangst') {
        const x = await voorraadOntvangen({ productId, locatieId, aantal, ontvangenOp, tht: tht || undefined, aankoopprijs: aankoop || undefined, opmerking: opmerking || undefined, thtBevestigd });
        const p = x.prijsWijziging;
        gewijzigd(x, `Ontvangst bewaard: ${hoeveelheid(getal(aantal), x.product.eenheid)}${tht ? `, THT ${datumNl(tht)}` : ''}.`
          + (p ? ` Hogere aankoopprijs: ${euroNl(p.oudeInkoop)} → ${euroNl(p.inkoopprijs)}${p.verkoopprijs !== p.oudeVerkoop ? `; verkoopprijs ${euroNl(p.oudeVerkoop)} → ${euroNl(p.verkoopprijs)}` : ''}.` : ''));
      } else if (modus === 'bestaand') {
        if (!tht) { setFout('Geef de THT.'); return; }
        const x = await voorraadOntvangen({ productId, locatieId, aantal, tht, opmerking: opmerking || undefined, bestaand: true, thtBevestigd });
        gewijzigd(x, `THT ${datumNl(tht)} geregistreerd voor ${hoeveelheid(getal(aantal), x.product.eenheid)}. De voorraad bleef gelijk.`);
        // Nog iets zonder THT (bv. een tweede THT)? Dan blijven we hier, anders terug naar Ontvangen.
        const rest = x.locaties.find((l) => l.id === locatieId)?.zonderTht ?? 0;
        if (rest > 0) setAantal(String(rest).replace('.', ','));
        else if (!x.locaties.some((l) => l.zonderTht > 0)) {
          setModus('ontvangst');
          if (voorBestaand) { setLocatieId(voorBestaand); setVoorBestaand(null); }
        }
      }
      else if (modus === 'afboeken') gewijzigd(await voorraadAfboeken({ productId, locatieId, aantal, reden, opmerking: opmerking || undefined }), 'Afgeboekt.');
      else gewijzigd(await voorraadTellen({ productId, locatieId, geteld: aantal, opmerking: opmerking || undefined }), 'Telling bewaard.');
    } catch (e) {
      toonFout(e, 'invoer');
    } finally {
      setBezig(false);
    }
  }

  async function bewaarLot(thtBevestigd = false) {
    if (!bewerk) return;
    setFout(''); setMelding(''); setBevestig(null); setBezig(true);
    try {
      const x = await wijzigOntvangst(bewerk.id, { tht: bewerk.tht, ...(bewerk.bestaand ? {} : { ontvangenOp: bewerk.ontvangenOp }), opmerking: bewerk.opmerking, thtBevestigd });
      setBewerk(null);
      verversNaLot(x, 'Ontvangst aangepast.');
    } catch (e) {
      toonFout(e, 'lot');
    } finally {
      setBezig(false);
    }
  }

  async function annuleer(id: string) {
    setFout(''); setMelding(''); setBezig(true);
    try { setTeAnnuleren(null); verversNaLot(await annuleerOntvangst(id), 'Ontvangst geannuleerd.'); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Annuleren mislukt'); }
    finally { setBezig(false); }
  }

  async function wisselTht(v: boolean) {
    setFout('');
    try { const x = await zetThtNodig(productId, v); setA(x); onGewijzigd?.(x); window.dispatchEvent(new Event('voorraad-gewijzigd')); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }

  if (!a) return <div style={{ color: fout ? 'crimson' : '#6b7280' }}>{fout || 'Voorraad laden…'}</div>;
  if (!a.product.heeftVoorraad) return <div style={{ color: '#6b7280' }}>Dit artikel heeft geen voorraad (vrij bedrag of statiegeld).</div>;
  const eenheid = a.product.eenheid;
  const loc = a.locaties.find((l) => l.id === locatieId);
  const locNaam = loc?.naam ?? '';
  const huidig = loc?.aantal ?? 0;
  const zonderTht = a.product.thtNodig ? a.locaties.reduce((s, l) => s + l.zonderTht, 0) : 0;
  const metBestaand = zonderTht > 0 || modus === 'bestaand';
  const loten = alles ? a.loten : a.loten.filter((l) => l.rest > 0);
  const kolommen = 7;

  function bewerkRij(l: VoorraadLot) {
    setTeAnnuleren(null); setBevestig(null);
    setBewerk({ id: l.id, tht: l.tht ?? '', ontvangenOp: l.ontvangenOp, opmerking: l.opmerking ?? '', bestaand: l.bron === 'BESTAAND' });
  }

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
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>
        Aankoopprijs {euroNl(a.product.inkoopprijs)} · verkoopprijs {euroNl(a.product.verkoopprijs)}
        {a.product.factor != null
          ? <> · factor {String(a.product.factor).replace('.', ',')} <span style={{ color: '#6b7280' }}>(een hogere aankoopprijs bij ontvangst laat de verkoopprijs meestijgen)</span></>
          : <span style={{ color: '#6b7280' }}> · geen factor (een hogere aankoopprijs bij ontvangst wordt de nieuwe aankoopprijs)</span>}
      </div>
      {a.locaties.some((l) => l.aantal < 0) && (
        <div style={waarschuwing}>De voorraad staat onder nul: er werd meer verkocht dan ontvangen. Tel het artikel en zet de juiste stand.</div>
      )}
      {zonderTht > 0 && (
        <div style={{ ...waarschuwing, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 240px' }}>
            {hoeveelheid(zonderTht, eenheid)} ligt er zonder THT (van vóór de registratie, of ontvangen zonder THT).
            Registreer de THT van wat er ligt: de voorraad blijft dan gelijk.
          </span>
          {modus !== 'bestaand' && <button type="button" onClick={() => kiesModus('bestaand')} style={btnKlein}>THT registreren</button>}
        </div>
      )}
      {metThtSchakelaar && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, margin: '6px 0 10px' }}>
          <input type="checkbox" checked={a.product.thtNodig} onChange={(e) => wisselTht(e.target.checked)} />
          THT nodig bij ontvangst <span style={{ color: '#6b7280', fontSize: 12 }}>(uit voor non-food, wijn, groenten…)</span>
        </label>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['ontvangst', ...(metBestaand ? ['bestaand'] : []), 'afboeken', 'tellen'] as Modus[]).map((m) => (
          <button key={m} type="button" onClick={() => kiesModus(m)} style={tab(modus === m)}>
            {m === 'ontvangst' ? 'Ontvangen' : m === 'bestaand' ? 'THT van wat er ligt' : m === 'afboeken' ? 'Afboeken' : 'Tellen'}
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
              <input type="date" value={ontvangenOp} max={vandaag()} onChange={(e) => { setOntvangenOp(e.target.value); setBevestig(null); }} style={inp} />
            </label>
            <label style={lab}>THT{a.product.thtNodig ? ' *' : ' (optioneel)'}
              <input type="date" value={tht} min={ontvangenOp} onChange={(e) => { setTht(e.target.value); setBevestig(null); }} style={inp} />
            </label>
            <label style={lab}>Aankoopprijs € (zonder btw)
              <input value={aankoop} onChange={(e) => setAankoop(e.target.value)} inputMode="decimal" placeholder="optioneel" style={{ ...inp, width: 100 }} />
            </label>
          </>
        )}
        {modus === 'bestaand' && (
          <label style={lab}>THT *
            <input type="date" value={tht} onChange={(e) => { setTht(e.target.value); setBevestig(null); }} style={inp} />
          </label>
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
        <button type="button" onClick={() => bewaar()} disabled={bezig} style={btnBlauw}>
          {bezig ? 'Bezig…' : modus === 'ontvangst' ? 'Ontvangst bewaren' : modus === 'bestaand' ? 'THT registreren' : modus === 'afboeken' ? 'Afboeken' : 'Telling bewaren'}
        </button>
        {modus === 'tellen' && <div style={hint}>Nu op {locNaam}: {hoeveelheid(huidig, eenheid)}. Wat je telt, wordt de voorraad; het verschil komt in het logboek.</div>}
        {modus === 'bestaand' && (
          <div style={hint}>
            Op {locNaam} ligt {hoeveelheid(loc?.zonderTht ?? 0, eenheid)} zonder THT. De voorraad blijft {hoeveelheid(huidig, eenheid)}: je registreert enkel de THT.
            Verschillende THT's? Registreer ze één voor één. Ligt er meer dan de voorraad zegt? Tel het artikel dan eerst.
          </div>
        )}
      </div>
      {bevestig?.wat === 'invoer' && <Bevestig tekst={bevestig.tekst} bezig={bezig} onJa={() => bewaar(true)} onNee={() => setBevestig(null)} />}
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
                <th style={th}>Ontvangen</th><th style={th}>Locatie</th><th style={{ ...th, textAlign: 'right' }}>Aantal</th><th style={th}>THT</th><th style={{ ...th, textAlign: 'right' }}>Nog aanwezig*</th><th style={th}>Door</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {loten.map((l) => (
                <LotRij key={l.id} l={l} eenheid={eenheid} kolommen={kolommen} thtNodig={a.product.thtNodig} isAdmin={isAdmin} bezig={bezig}
                  bewerk={bewerk?.id === l.id ? bewerk : null} setBewerk={(b) => { setBewerk(b); setBevestig(null); }} onBewerk={() => bewerkRij(l)} onBewaar={() => bewaarLot()}
                  bevestig={bewerk?.id === l.id && bevestig?.wat === 'lot' ? <Bevestig tekst={bevestig.tekst} bezig={bezig} onJa={() => bewaarLot(true)} onNee={() => setBevestig(null)} /> : null}
                  teAnnuleren={teAnnuleren === l.id} onAnnuleerVraag={() => { setBewerk(null); setTeAnnuleren(l.id); }} onAnnuleer={() => annuleer(l.id)} onNiet={() => setTeAnnuleren(null)} />
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>* Geschat uit de actuele voorraad: wat het eerst vervalt, gaat eerst weg.</div>
        </div>
      )}

      {a.correcties.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Logboek: afboekingen, tellingen en aanpassingen ({a.correcties.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14 }}>
            {a.correcties.map((c) => (
              <li key={c.id}>
                {new Date(c.op).toLocaleDateString('nl-BE')} · {REDEN[c.reden] ?? c.reden}
                {c.aantal !== 0 ? ` · ${c.aantal > 0 ? '+' : ''}${hoeveelheid(c.aantal, eenheid)}` : ''} ({c.locatie}){c.door ? ` · ${c.door}` : ''}{c.opmerking ? ` · ${c.opmerking}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Bevestig({ tekst, bezig, onJa, onNee }: { tekst: string; bezig: boolean; onJa: () => void; onNee: () => void }) {
  return (
    <div style={{ ...waarschuwing, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      <span style={{ flex: '1 1 240px' }}>{tekst}</span>
      <button type="button" onClick={onJa} disabled={bezig} style={btnKlein}>Ja, de THT klopt</button>
      <button type="button" onClick={onNee} style={btnKlein}>Nee, aanpassen</button>
    </div>
  );
}

// Eén ontvangst in de tabel, met eronder (als gevraagd) het aanpassen of de vraag om te annuleren.
function LotRij(p: {
  l: VoorraadLot; eenheid: string; kolommen: number; thtNodig: boolean; isAdmin: boolean; bezig: boolean;
  bewerk: Bewerk | null; setBewerk: (b: Bewerk | null) => void; onBewerk: () => void; onBewaar: () => void; bevestig: ReactNode;
  teAnnuleren: boolean; onAnnuleerVraag: () => void; onAnnuleer: () => void; onNiet: () => void;
}) {
  const { l, eenheid, bewerk } = p;
  const bron = l.bron === 'FACTUUR' ? ' · factuur' : l.bron === 'BESTAAND' ? ' · lag er al' : '';
  return (
    <>
      <tr style={{ borderBottom: '1px solid #f3f4f6', opacity: l.geannuleerd ? 0.5 : l.rest > 0 ? 1 : 0.55 }}>
        <td style={td}>
          {datumNl(l.ontvangenOp)}{bron && <span style={{ color: '#6b7280', fontSize: 12 }}>{bron}</span>}
          {l.geannuleerd && <div style={{ color: '#b91c1c', fontSize: 12 }}>geannuleerd{l.geannuleerdDoor ? ` door ${l.geannuleerdDoor}` : ''}</div>}
          {l.opmerking && <div style={{ color: '#6b7280', fontSize: 12 }}>{l.opmerking}</div>}
        </td>
        <td style={td}>{l.locatie}</td>
        <td style={{ ...td, textAlign: 'right', textDecoration: l.geannuleerd ? 'line-through' : undefined }}>{hoeveelheid(l.aantal, eenheid)}</td>
        <td style={td}>
          {l.tht ? <>{datumNl(l.tht)} <ThtLabel status={l.status} dagen={l.dagenTotTht} /></>
            : p.thtNodig && !l.geannuleerd && l.thtInvulbaar ? <button type="button" onClick={p.onBewerk} style={linkKnop}>THT invullen</button>
            : <span style={{ color: '#9ca3af' }}>—</span>}
        </td>
        <td style={{ ...td, textAlign: 'right', fontWeight: l.rest > 0 ? 600 : 400 }}>{hoeveelheid(l.rest, eenheid)}</td>
        <td style={{ ...td, color: '#6b7280' }}>{l.door ?? ''}</td>
        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
          {!l.geannuleerd && <button type="button" onClick={p.onBewerk} style={linkKnop}>Wijzig</button>}
          {!l.geannuleerd && p.isAdmin && <button type="button" onClick={p.onAnnuleerVraag} style={{ ...linkKnop, color: '#b91c1c', marginLeft: 10 }}>Annuleer</button>}
        </td>
      </tr>
      {bewerk && (
        <tr>
          <td colSpan={p.kolommen} style={{ padding: '6px 6px 10px', background: '#f8fafc' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={lab}>THT{p.thtNodig || bewerk.bestaand ? ' *' : ''}
                <input type="date" value={bewerk.tht} onChange={(e) => p.setBewerk({ ...bewerk, tht: e.target.value })} style={inp} />
              </label>
              {!bewerk.bestaand && (
                <label style={lab}>Ontvangen op
                  <input type="date" value={bewerk.ontvangenOp} max={vandaag()} onChange={(e) => p.setBewerk({ ...bewerk, ontvangenOp: e.target.value })} style={inp} />
                </label>
              )}
              <label style={{ ...lab, flex: '1 1 140px' }}>Opmerking
                <input value={bewerk.opmerking} onChange={(e) => p.setBewerk({ ...bewerk, opmerking: e.target.value })} maxLength={200} style={{ ...inp, width: '100%' }} />
              </label>
              <button type="button" onClick={p.onBewaar} disabled={p.bezig} style={btnBlauw}>{p.bezig ? 'Bezig…' : 'Bewaren'}</button>
              <button type="button" onClick={() => p.setBewerk(null)} style={btnKlein}>Sluiten</button>
            </div>
            {p.bevestig}
            <div style={hint}>Het aantal pas je niet hier aan: tel het artikel, of laat een beheerder de ontvangst annuleren.</div>
          </td>
        </tr>
      )}
      {p.teAnnuleren && (
        <tr>
          <td colSpan={p.kolommen} style={{ padding: '8px 6px 10px', background: '#fef2f2' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 260px', fontSize: 14 }}>
                Ontvangst van {datumNl(l.ontvangenOp)} ({hoeveelheid(l.aantal, eenheid)}) annuleren?{' '}
                {l.bron === 'BESTAAND' ? 'De voorraad blijft gelijk.'
                  : l.geteldNa ? `De voorraad blijft gelijk: het artikel werd na deze ontvangst geteld.`
                  : `De voorraad op ${l.locatie} gaat ${hoeveelheid(l.aantal, eenheid)} omlaag.`}{' '}
                Aankoop- en verkoopprijs blijven zoals ze zijn.
              </span>
              <button type="button" onClick={p.onAnnuleer} disabled={p.bezig} style={{ ...btnKlein, color: '#b91c1c', borderColor: '#fca5a5' }}>Ja, annuleren</button>
              <button type="button" onClick={p.onNiet} style={btnKlein}>Nee</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const tegel = (rood: boolean): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: 10, padding: '6px 12px', minWidth: 90, background: rood ? '#fef2f2' : '#fff', color: rood ? '#991b1b' : undefined });
const waarschuwing: CSSProperties = { background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '6px 10px', fontSize: 13, margin: '6px 0' };
const tab = (aan: boolean): CSSProperties => ({ padding: '6px 14px', borderRadius: 999, cursor: 'pointer', border: aan ? '2px solid #0d4589' : '1px solid #cbd5e1', background: aan ? '#eff6ff' : '#fff', fontWeight: aan ? 700 : 500 });
const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#6b7280' };
const inp: CSSProperties = { padding: 7, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box' };
const btnBlauw: CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnKlein: CSSProperties = { padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151' };
const linkKnop: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#0d4589', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 };
const hint: CSSProperties = { width: '100%', fontSize: 12, color: '#6b7280' };
const th: CSSProperties = { padding: '4px 6px' };
const td: CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
