import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getKassaFacturen, getMailStatus, mailRekening, verstuurFactuurNaarScrada, type KassaFactuur, type KassaFacturen } from '../api/client';
import { heeftRecht } from '../rechten';

const euro = (n: number) => '€ ' + n.toFixed(2).replace('.', ',');
const datumNl = (d: string) => new Date(d).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' });
const BETAALWIJZE: Record<string, string> = { CASH: 'cash', BANCONTACT: 'Bancontact', KAART: 'kaart', QR: 'QR', CADEAUBON: 'cadeaubon', ONLINE: 'online', OVERSCHRIJVING: 'overschrijving' };
const betaalwijzeNl = (s: string | null) => (s ? s.split('+').map((w) => BETAALWIJZE[w] ?? w.toLowerCase()).join(' + ') : '');

// Waarom een factuur hier niet verstuurd mag worden (null = gewoon versturen).
function waaromNiet(f: KassaFactuur): string | null {
  if (f.verkoopGeannuleerd) return 'verkoop geannuleerd: niet versturen (verwijder de factuur in Boekhouding)';
  if (f.verkoopOntbreekt) return 'geen ticket meer gekoppeld (verwijderd of dubbele factuur): niet versturen (verwijder de factuur in Boekhouding)';
  if (f.totaalIncl < 0) return 'terugbetaling (negatief bedrag): hiervoor hoort een creditnota, geen factuur. Niet versturen (verwijder de factuur in Boekhouding)';
  return null;
}

// Blijft bewaard zolang de pagina open is: na "Ticket" bekijken staat de filter nog zoals je hem liet.
let ookVerstuurdOnthouden = false;

// Facturen die aan de kassa gevraagd werden ("🧾 Factuur voor deze verkoop"), op de pagina Klant
// factuur: eerst wat nog naar de klant moet. Bedrijven (met BTW-nummer) krijgen de factuur via
// Scrada (Peppol), particulieren per e-mail. Versturen kan wie toegang heeft tot de boekhouding.
export function KassaFacturenBlok({ onDetail }: { onDetail: (verkoopId: string) => void }) {
  const [data, setData] = useState<KassaFacturen | null>(null);
  const [ookVerstuurd, setOokVerstuurd] = useState(ookVerstuurdOnthouden);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState<string | null>(null); // id van de factuur die nu verstuurd wordt
  const [scradaVraag, setScradaVraag] = useState<string | null>(null); // id: "naar Scrada?" bevestigen
  const [mailVoor, setMailVoor] = useState<{ id: string; naar: string } | null>(null);
  const [mailKlaar, setMailKlaar] = useState<boolean | null>(null); // e-mail (SMTP) ingesteld?
  const magVersturen = heeftRecht('boekhouding');
  const laadNr = useRef(0);
  const ookRef = useRef(ookVerstuurdOnthouden); // altijd de huidige filter, ook na een lange actie
  const verstuurBezig = useRef(false); // nooit twee keer tegelijk versturen (dubbel Enter, dubbelklik)
  const geopendOp = useRef(0); // wanneer "Ja"/"Versturen" verscheen: een dubbelklik bevestigt niet meteen
  const netGeopend = () => performance.now() - geopendOp.current < 400;

  // Herladen wist geen melding of fout van een actie die net gebeurde (Scrada, mail).
  const [laadFout, setLaadFout] = useState('');
  async function laad(ook = ookRef.current) {
    const nr = ++laadNr.current;
    try {
      const d = await getKassaFacturen(ook);
      if (nr === laadNr.current) { setData(d); setLaadFout(''); }
    } catch (e) {
      if (nr === laadNr.current) setLaadFout(e instanceof Error ? e.message : 'Laden mislukt');
    }
  }
  useEffect(() => {
    void laad();
    if (magVersturen) getMailStatus().then((m) => setMailKlaar(m.geconfigureerd)).catch(() => setMailKlaar(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function kiesFilter(aan: boolean) {
    ookVerstuurdOnthouden = aan;
    ookRef.current = aan;
    setOokVerstuurd(aan);
    void laad(aan);
  }

  async function naarScrada(f: KassaFactuur) {
    if (bezig || verstuurBezig.current || netGeopend()) return;
    verstuurBezig.current = true;
    setScradaVraag(null); setBezig(f.id); setMelding(''); setFout('');
    try {
      const r = await verstuurFactuurNaarScrada(f.id);
      if (r.verstuurd) setMelding(`Factuur ${f.nummer} (${f.klantNaam}) staat als concept in Scrada${r.ref ? ` (ref ${r.ref})` : ''}. Verstuur ze vanuit Scrada naar de klant.`);
      else setFout(r.modus === 'test' ? 'Scrada is niet gekoppeld (testmodus): niets verstuurd.' : `Niet verstuurd: ${r.fout ?? r.melding ?? 'onbekende fout'}`);
      await laad();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Versturen mislukt');
    } finally {
      verstuurBezig.current = false;
      setBezig(null);
    }
  }

  // Zelfde regels als de knop "Versturen": niet tijdens een verzending, niet zonder adres.
  async function mail() {
    if (!mailVoor || bezig || verstuurBezig.current || !mailVoor.naar.trim() || netGeopend()) return;
    verstuurBezig.current = true;
    const { id, naar } = mailVoor;
    setBezig(id); setMelding(''); setFout('');
    try {
      const r = await mailRekening(id, naar.trim());
      setMelding(`Rekening ${r.nummer} gemaild naar ${r.naar}.`);
      setMailVoor(null);
      await laad();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Mailen mislukt');
    } finally {
      verstuurBezig.current = false;
      setBezig(null);
    }
  }

  const facturen = data?.facturen ?? [];
  const teVersturen = facturen.filter((f) => !f.verstuurd && !waaromNiet(f)).length;

  return (
    <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 12, padding: 14, margin: '12px 0 20px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>🧾 Facturen gevraagd aan de kassa</h3>
        {data && <span style={{ fontWeight: 600, color: teVersturen ? '#b45309' : '#166534' }}>{teVersturen ? `${teVersturen} nog te versturen` : 'alles verstuurd'}</span>}
        <label style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={ookVerstuurd} onChange={(e) => kiesFilter(e.target.checked)} />
          Ook verstuurde (laatste 3 maanden)
        </label>
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 8px' }}>
        Tickets waarbij aan de kassa "Factuur voor deze verkoop" aangevinkt werd. Bedrijven met een BTW-nummer krijgen de factuur via Scrada,
        particulieren per e-mail. Kijk ze na en verstuur ze; daarna verdwijnen ze uit deze lijst.
        {!magVersturen && ' Versturen kan wie toegang heeft tot de boekhouding.'}
      </p>
      {laadFout && <p style={{ color: 'crimson', margin: '4px 0' }}>{laadFout}</p>}
      {fout && <p style={{ color: 'crimson', margin: '4px 0' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', margin: '4px 0' }}>{melding}</p>}
      {magVersturen && mailKlaar === false && facturen.some((f) => !f.naarScrada && !f.verstuurd && !waaromNiet(f)) && (
        <p style={{ fontSize: 13, color: '#92400e', margin: '4px 0' }}>E-mail is nog niet ingesteld op de server: rekeningen mailen kan pas daarna.</p>
      )}

      {data && data.zonderFactuur.length > 0 && (
        <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 8, padding: '8px 10px', margin: '6px 0 10px', fontSize: 13 }}>
          <strong style={{ color: '#b91c1c' }}>Factuur gevraagd, maar die kon niet gemaakt worden:</strong>
          {data.zonderFactuur.map((z) => (
            <div key={z.verkoopId} style={{ marginTop: 4 }}>
              {datumNl(z.datum)} · {z.klantNaam ?? 'geen klant'} · {euro(z.totaal)} — {z.fout}{' '}
              <button type="button" onClick={() => onDetail(z.verkoopId)} disabled={!!bezig} style={btnMini}>Ticket</button>
            </div>
          ))}
        </div>
      )}

      {!data && !laadFout && <p style={{ color: '#6b7280', fontSize: 13 }}>Laden…</p>}
      {data && facturen.length === 0 && <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>{ookVerstuurd ? 'Geen facturen gevraagd aan de kassa in de laatste 3 maanden.' : 'Niets meer te versturen.'}</p>}
      {facturen.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640, background: '#fff' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #eee' }}>
                <th style={th}>Ticket</th><th style={th}>Klant</th><th style={th}>Factuur</th><th style={{ ...th, textAlign: 'right' }}>Bedrag</th><th style={th}>Versturen</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {facturen.map((f) => {
                const niet = waaromNiet(f);
                return (
                  <tr key={f.id} style={{ borderBottom: '1px solid #f5f5f5', verticalAlign: 'top' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{datumNl(f.verkoopDatum)}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{f.klantNaam}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{f.klantBtw ?? 'particulier'}{f.klantEmail ? ` · ${f.klantEmail}` : ''}</div>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {f.nummer}
                      <div style={{ fontSize: 12, color: f.betaalstatus === 'BETAALD' ? '#166534' : '#b45309' }}>
                        {f.betaalstatus === 'BETAALD' ? `betaald${f.betaalwijze ? ` (${betaalwijzeNl(f.betaalwijze)})` : ''}` : 'nog te betalen'}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{euro(f.totaalIncl)}</td>
                    <td style={td}>
                      {/* Mag afbreken (ook op de gsm): een lange Scrada-fout duwt de knoppen niet van het scherm. */}
                      <div style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                        {niet && !f.verstuurd
                          ? <span style={{ color: '#6b7280' }}>{niet}</span>
                          : f.naarScrada
                          ? f.verstuurd
                            ? <span style={{ color: '#166534' }}>✔ als concept in Scrada{f.scradaVerstuurdOp ? ` sinds ${datumNl(f.scradaVerstuurdOp)}` : ''}</span>
                            : f.scradaStatus === 'FOUT'
                              ? <span style={{ color: '#b91c1c' }}>Scrada gaf een fout{f.scradaFout ? `: ${f.scradaFout}` : ''}</span>
                              : <span style={{ color: '#b45309', fontWeight: 600 }}>nog naar Scrada</span>
                          : f.verstuurd
                            ? <span style={{ color: '#166534' }}>✔ gemaild {f.gemaildOp ? datumNl(f.gemaildOp) : ''}{f.gemaildNaar ? ` (${f.gemaildNaar})` : ''}</span>
                            : <span style={{ color: '#b45309', fontWeight: 600 }}>nog te mailen{f.klantEmail ? '' : ' (geen e-mail bekend)'}</span>}
                        {f.verstuurd && (f.verkoopGeannuleerd || f.verkoopOntbreekt) && (
                          <div style={{ color: '#b91c1c', fontSize: 12 }}>let op: {f.verkoopGeannuleerd ? 'de verkoop werd nadien geannuleerd' : 'er hangt geen ticket meer aan'}</div>
                        )}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {f.verkoopId && <button type="button" onClick={() => onDetail(f.verkoopId!)} disabled={!!bezig} style={btnMini}>Ticket</button>}{' '}
                      {magVersturen && !niet && f.naarScrada && !f.verstuurd && (scradaVraag === f.id ? (
                        <>
                          <span style={{ fontSize: 12 }}>Als concept naar Scrada? </span>
                          <button type="button" onClick={() => void naarScrada(f)} disabled={!!bezig} style={btnBlauw}>Ja</button>{' '}
                          <button type="button" onClick={() => setScradaVraag(null)} style={btnMini}>Nee</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => { geopendOp.current = performance.now(); setScradaVraag(f.id); setMailVoor(null); }} disabled={!!bezig} style={btnBlauw}>{bezig === f.id ? 'Bezig…' : 'Naar Scrada'}</button>
                      ))}
                      {magVersturen && !niet && !f.naarScrada && (mailVoor?.id === f.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input type="email" value={mailVoor.naar} onChange={(e) => setMailVoor({ id: f.id, naar: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat) void mail(); }}
                            placeholder="e-mailadres van de klant" autoFocus aria-label={`E-mailadres voor rekening ${f.nummer}`} style={{ padding: 5, fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, width: 190 }} />
                          <button type="button" onClick={() => void mail()} disabled={!!bezig || !mailVoor.naar.trim()} style={btnBlauw}>{bezig === f.id ? 'Bezig…' : 'Versturen'}</button>
                          <button type="button" onClick={() => setMailVoor(null)} disabled={!!bezig} style={btnMini}>×</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => { geopendOp.current = performance.now(); setMailVoor({ id: f.id, naar: f.gemaildNaar ?? f.klantEmail ?? '' }); setScradaVraag(null); }}
                          disabled={!!bezig || mailKlaar === false} title={mailKlaar === false ? 'E-mail is nog niet ingesteld op de server' : 'Rekening per e-mail naar de klant'} style={btnBlauw}>
                          {f.verstuurd ? 'Opnieuw mailen' : '✉️ Mailen'}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: CSSProperties = { padding: 5 };
const td: CSSProperties = { padding: 5 };
const btnMini: CSSProperties = { padding: '3px 9px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 };
const btnBlauw: CSSProperties = { padding: '4px 10px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
