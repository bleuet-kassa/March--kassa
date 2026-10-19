import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRekeningKlanten, getRekeningUittreksel, getTicket, type RekeningKlant, type Uittreksel, type Ticket } from '../api/client';
import { TicketWeergave } from './Kassa';

// Klantrekeningen: per klant (of bedrijf) een duidelijk uittreksel zoals bij de bank:
// elke aankoop op rekening met datum, artikels en wie bediende; elke opgemaakte
// rekening/factuur; elke ontvangen betaling; en het lopende saldo. Zo kan je bij een
// vraag van een klant meteen tonen en uitleggen hoe het bedrag tot stand kwam.
const euro = (n: number) => (n < 0 ? '−' : '') + '€ ' + Math.abs(n).toFixed(2);
const datumTijd = (s: string) => new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const datum = (s: string) => new Date(s).toLocaleDateString('nl-BE');

export function Klantrekeningen() {
  const { sleutel } = useParams();
  return sleutel ? <UittrekselPagina sleutel={decodeURIComponent(sleutel)} /> : <KlantenLijst />;
}

function KlantenLijst() {
  const [lijst, setLijst] = useState<RekeningKlant[]>([]);
  const [zoek, setZoek] = useState('');
  const [enkelOpen, setEnkelOpen] = useState(false);
  const [fout, setFout] = useState('');
  useEffect(() => { getRekeningKlanten().then(setLijst).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt')); }, []);
  const zichtbaar = lijst.filter((k) => (!zoek.trim() || k.naam.toLowerCase().includes(zoek.trim().toLowerCase())) && (!enkelOpen || k.saldo > 0.005));

  return (
    <div style={{ maxWidth: 940 }}>
      <h2 style={{ margin: '0 0 4px' }}>Klantrekeningen</h2>
      <p style={{ color: '#6b7280', marginTop: 0, fontSize: 14 }}>Iedereen die ooit op rekening kocht. Klik op een klant voor het volledige overzicht: elke aankoop met datum, de rekeningen en de betalingen, met het saldo erbij.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek klant…" style={{ ...inp, maxWidth: 320 }} />
        <label style={{ fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={enkelOpen} onChange={(e) => setEnkelOpen(e.target.checked)} /> enkel met openstaand saldo</label>
        <Link to="/kassa/open-rekeningen" style={{ marginLeft: 'auto', fontSize: 14 }}>Betaling ontvangen → Open rekeningen</Link>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280', borderBottom: '2px solid #e5e7eb' }}>
              <th style={th}>Klant</th><th style={{ ...th, textAlign: 'right' }}>Aankopen</th><th style={{ ...th, textAlign: 'right' }}>Betaald aan de kassa</th><th style={{ ...th, textAlign: 'right' }}>Saldo</th><th style={th}>Laatste</th>
            </tr>
          </thead>
          <tbody>
            {zichtbaar.map((k) => (
              <tr key={k.sleutel} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={td}>
                  <Link to={`/kassa/klantrekeningen/${encodeURIComponent(k.sleutel)}`} style={{ fontWeight: 600 }}>{k.naam}</Link>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{k.isBedrijf ? `bedrijf${k.btwNummer ? ' · ' + k.btwNummer : ''}` : 'particulier'}{k.telefoon ? ` · ☎ ${k.telefoon}` : ''}</div>
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{euro(k.aankopen)}<div style={{ fontSize: 12, color: '#6b7280' }}>{k.aantal} aankopen</div></td>
                <td style={{ ...td, textAlign: 'right' }}>{k.isBedrijf ? <span style={{ color: '#6b7280', fontSize: 12 }}>per overschrijving</span> : euro(k.betaald)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: k.isBedrijf ? '#374151' : k.saldo > 0.005 ? '#b45309' : '#166534' }}>
                  {k.isBedrijf ? <span style={{ fontWeight: 400, fontSize: 12 }}>{k.nogTeFactureren > 0.005 ? `${euro(k.nogTeFactureren)} te factureren` : 'alles gefactureerd'}</span> : k.saldo > 0.005 ? euro(k.saldo) : 'betaald'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b7280' }}>{datum(k.laatste)}</td>
              </tr>
            ))}
            {zichtbaar.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#6b7280' }}>{lijst.length ? 'Geen klant gevonden.' : 'Nog geen aankopen op rekening.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UittrekselPagina({ sleutel }: { sleutel: string }) {
  const nav = useNavigate();
  const [u, setU] = useState<Uittreksel | null>(null);
  const [van, setVan] = useState('');
  const [tot, setTot] = useState('');
  const [fout, setFout] = useState('');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [toonFacturen, setToonFacturen] = useState(true);
  // Bedrijven: standaard per maand en per persoon (wat op welke maandfactuur hoort).
  const [weergave, setWeergave] = useState<'persoon' | 'chrono' | null>(null);

  async function laad(v = van, t = tot) {
    setFout('');
    try { setU(await getRekeningUittreksel(sleutel, v || undefined, t || undefined)); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
  }
  useEffect(() => { laad(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sleutel]);

  const regels = useMemo(() => (u?.regels ?? []).filter((r) => toonFacturen || r.soort !== 'FACTUUR'), [u, toonFacturen]);
  if (ticket) return <TicketWeergave ticket={ticket} autoPrint={false} onNieuw={() => setTicket(null)} nieuwLabel="← Terug naar het overzicht" />;
  if (!u) return <div>{fout || 'Laden…'} <Link to="/kassa/klantrekeningen">← Klantrekeningen</Link></div>;
  const k = u.klant;
  const heeftLeden = u.regels.some((r) => r.soort === 'AANKOOP' && r.lid);
  const toon = weergave ?? (k.isBedrijf && heeftLeden ? 'persoon' : 'chrono');
  const openTicket = async (id: string) => { try { setTicket(await getTicket(id)); } catch (e) { setFout(e instanceof Error ? e.message : 'Ticket ophalen mislukt'); } };

  function periode(maanden: number | null) {
    if (maanden === null) { setVan(''); setTot(''); laad('', ''); return; }
    const nu = new Date();
    const b = new Date(nu.getFullYear(), nu.getMonth() - maanden + 1, 1);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setVan(f(b)); setTot(f(nu)); laad(f(b), f(nu));
  }

  return (
    <div style={{ maxWidth: 980 }} className="uittreksel">
      <div className="niet-afdrukken" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={() => nav('/kassa/klantrekeningen')} style={btnGrijs}>← Klantrekeningen</button>
        <button onClick={() => window.print()} style={btnGrijs}>🖨 Afdrukken</button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
          <button onClick={() => periode(1)} style={btnMini}>Deze maand</button>
          <button onClick={() => periode(3)} style={btnMini}>3 maanden</button>
          <button onClick={() => periode(12)} style={btnMini}>12 maanden</button>
          <button onClick={() => periode(null)} style={btnMini}>Alles</button>
          van <input type="date" value={van} onChange={(e) => setVan(e.target.value)} style={{ ...inp, width: 'auto', padding: 5 }} />
          tot <input type="date" value={tot} onChange={(e) => setTot(e.target.value)} style={{ ...inp, width: 'auto', padding: 5 }} />
          <button onClick={() => laad()} style={btnMini}>Toon</button>
        </span>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Rekeningoverzicht</div>
          <h2 style={{ margin: '2px 0' }}>{k.naam}</h2>
          <div style={{ fontSize: 14, color: '#374151' }}>
            {k.isBedrijf ? `Bedrijf${k.btwNummer ? ' · ' + k.btwNummer : ''}` : 'Particulier'}
            {k.telefoon ? ` · ☎ ${k.telefoon}` : ''}{k.email ? ` · ${k.email}` : ''}
          </div>
          {k.adres && <div style={{ fontSize: 14, color: '#374151' }}>{k.adres}</div>}
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Periode: {u.van ? datum(u.van) : 'begin'} – {u.tot ? datum(u.tot) : 'vandaag'} · afgedrukt {datumTijd(new Date().toISOString())}</div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {u.vorigSaldo !== null && <Cijfer label="Vorig saldo" waarde={euro(u.vorigSaldo)} />}
          <Cijfer label={`Aankopen (${u.totalen.aantalAankopen})`} waarde={euro(u.totalen.aankopen)} />
          {!k.isBedrijf && <Cijfer label="Betaald" waarde={euro(u.totalen.betalingen)} />}
          <Cijfer label={k.isBedrijf ? 'Nog te factureren' : 'Saldo'} waarde={euro(k.isBedrijf ? u.totalen.nogTeFactureren : u.totalen.eindSaldo)} nadruk />
        </div>
      </div>
      {u.opmerking && <p style={{ fontSize: 13, color: '#6b7280' }}>{u.opmerking}</p>}

      <div className="niet-afdrukken" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0 4px' }}>
        {heeftLeden && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setWeergave('persoon')} style={{ ...btnMini, fontWeight: toon === 'persoon' ? 700 : 400, background: toon === 'persoon' ? '#111827' : '#fff', color: toon === 'persoon' ? '#fff' : '#111827' }}>Per maand en per persoon</button>
            <button onClick={() => setWeergave('chrono')} style={{ ...btnMini, fontWeight: toon === 'chrono' ? 700 : 400, background: toon === 'chrono' ? '#111827' : '#fff', color: toon === 'chrono' ? '#fff' : '#111827' }}>Alles chronologisch</button>
          </div>
        )}
        {toon === 'chrono' && (
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={toonFacturen} onChange={(e) => setToonFacturen(e.target.checked)} /> ook de opgemaakte rekeningen/facturen tonen
          </label>
        )}
      </div>
      {toon === 'persoon' && <PerPersoon regels={u.regels} onTicket={openTicket} />}
      {toon === 'chrono' && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 720 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280', borderBottom: '2px solid #e5e7eb' }}>
              <th style={th}>Datum</th><th style={th}>Omschrijving</th><th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Bedrag</th><th style={{ ...th, textAlign: 'right' }}>Saldo</th><th className="niet-afdrukken" style={th} />
            </tr>
          </thead>
          <tbody>
            {u.vorigSaldo !== null && (
              <tr style={{ borderBottom: '1px solid #f0f0f0', background: '#f9fafb' }}>
                <td style={td}>{u.van ? datum(u.van) : ''}</td><td style={{ ...td, fontStyle: 'italic' }}>Saldo vóór deze periode</td><td style={td} /><td style={td} />
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{euro(u.vorigSaldo)}</td><td className="niet-afdrukken" style={td} />
              </tr>
            )}
            {regels.map((r, i) => {
              const kleur = r.soort === 'BETALING' ? '#166534' : r.soort === 'FACTUUR' ? '#6b7280' : '#111827';
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', opacity: r.status === 'geannuleerd' ? .5 : 1 }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{datumTijd(r.datum)}</td>
                  <td style={{ ...td, verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600, color: kleur }}>{r.soort === 'BETALING' ? '💶 ' : r.soort === 'FACTUUR' ? '🧾 ' : '🛒 '}{r.omschrijving}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{r.detail}</div>
                  </td>
                  <td style={{ ...td, fontSize: 12, color: '#6b7280', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{r.status}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top', color: r.bedrag < 0 ? '#166534' : '#111827', textDecoration: r.status === 'geannuleerd' ? 'line-through' : 'none' }}>
                    {r.soort === 'FACTUUR' ? '' : euro(r.bedrag)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>{r.soort === 'FACTUUR' ? '' : euro(r.saldo)}</td>
                  <td className="niet-afdrukken" style={{ ...td, textAlign: 'right', verticalAlign: 'top' }}>
                    {r.verkoopId && <button onClick={async () => { try { setTicket(await getTicket(r.verkoopId!)); } catch (e) { setFout(e instanceof Error ? e.message : 'Ticket ophalen mislukt'); } }} style={btnMini}>Ticket</button>}
                  </td>
                </tr>
              );
            })}
            {regels.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#6b7280' }}>Geen bewegingen in deze periode.</td></tr>}
          </tbody>
          {regels.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid #111827', fontWeight: 700 }}>
                <td style={td} colSpan={3}>{k.isBedrijf ? 'Totaal aankopen in deze periode' : 'Saldo op het einde van de periode'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{k.isBedrijf ? euro(u.totalen.aankopen) : ''}</td>
                <td style={{ ...td, textAlign: 'right' }}>{k.isBedrijf ? '' : euro(regels.filter((r) => r.soort !== 'FACTUUR').slice(-1)[0]?.saldo ?? u.vorigSaldo ?? 0)}</td>
                <td className="niet-afdrukken" style={td} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>}
      <style>{'@media print { nav, .niet-afdrukken { display: none !important; } main { padding: 0 !important; } .uittreksel { max-width: none !important; } }'}</style>
    </div>
  );
}

// Bedrijven: per kalendermaand en per personeelslid de aankopen, met subtotalen en
// de maandfactuur waarin ze zitten (of "nog te factureren").
function PerPersoon({ regels, onTicket }: { regels: Uittreksel['regels']; onTicket: (id: string) => void }) {
  const aankopen = regels.filter((r) => r.soort === 'AANKOOP' && r.status !== 'geannuleerd');
  const maanden = [...new Set(aankopen.map((r) => r.datum.slice(0, 7)))].sort().reverse();
  if (!maanden.length) return <p style={{ color: '#6b7280' }}>Geen aankopen in deze periode.</p>;
  const maandNaam = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {maanden.map((m) => {
        const inMaand = aankopen.filter((r) => r.datum.slice(0, 7) === m);
        const facturen = [...new Set(inMaand.map((r) => r.factuurNummer).filter(Boolean))] as string[];
        const open = inMaand.filter((r) => !r.factuurNummer);
        const leden = [...new Set(inMaand.map((r) => r.lid ?? '(geen personeelslid)'))].sort((a, b) => a.localeCompare(b, 'nl'));
        return (
          <section key={m} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', breakInside: 'avoid' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '10px 12px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
              <strong style={{ fontSize: 16, textTransform: 'capitalize' }}>{maandNaam(m)}</strong>
              <span style={{ fontSize: 13, color: '#374151' }}>
                {facturen.length ? `factuur ${facturen.join(', ')}` : ''}
                {facturen.length && open.length ? ' · ' : ''}
                {open.length ? <span style={{ color: '#b45309', fontWeight: 600 }}>{euro(open.reduce((s, r) => s + r.bedrag, 0))} nog te factureren</span> : ''}
              </span>
              <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{euro(inMaand.reduce((s, r) => s + r.bedrag, 0))}</strong>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 600 }}>
                <tbody>
                  {leden.map((lid) => {
                    const rijen = inMaand.filter((r) => (r.lid ?? '(geen personeelslid)') === lid);
                    return [
                      <tr key={lid + '-kop'} style={{ background: '#fff' }}>
                        <td colSpan={3} style={{ ...td, fontWeight: 700, paddingTop: 10 }}>{lid} <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 13 }}>· {rijen.length} aankoop{rijen.length === 1 ? '' : 'en'}</span></td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, paddingTop: 10, fontVariantNumeric: 'tabular-nums' }}>{euro(rijen.reduce((s, r) => s + r.bedrag, 0))}</td>
                        <td className="niet-afdrukken" style={td} />
                      </tr>,
                      ...rijen.map((r, i) => (
                        <tr key={lid + i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ ...td, paddingLeft: 18, whiteSpace: 'nowrap', color: '#374151' }}>{datumTijd(r.datum)}</td>
                          <td style={{ ...td, color: '#374151' }}>{r.artikels ?? r.detail}</td>
                          <td style={{ ...td, fontSize: 12, color: r.factuurNummer ? '#6b7280' : '#b45309', whiteSpace: 'nowrap' }}>{r.factuurNummer ? `factuur ${r.factuurNummer}` : 'nog te factureren'}</td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{euro(r.bedrag)}</td>
                          <td className="niet-afdrukken" style={{ ...td, textAlign: 'right' }}>{r.verkoopId && <button onClick={() => onTicket(r.verkoopId!)} style={btnMini}>Ticket</button>}</td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Cijfer({ label, waarde, nadruk }: { label: string; waarde: string; nadruk?: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: nadruk ? 24 : 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: nadruk ? '#b45309' : '#111827' }}>{waarde}</div>
    </div>
  );
}

const th: CSSProperties = { padding: '6px 6px' };
const td: CSSProperties = { padding: '6px 6px' };
const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const btnGrijs: CSSProperties = { padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
const btnMini: CSSProperties = { padding: '4px 9px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 };
