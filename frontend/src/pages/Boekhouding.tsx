import { useEffect, useState, type CSSProperties } from 'react';
import {
  getScradaStatus, getScradaOpenstaande, getScradaPreview,
  scradaVerstuurEen, scradaVerstuurAlles, getScradaVerbinding, zetScradaVanaf, scradaResetStatus,
  type ScradaStatus, type OpenstaandeVerkoop, type ScradaFactuur, type ScradaConfig, type ScradaVerbinding, type ScradaSyncVerslag,
} from '../api/client';

// Boekhouding (Fase 3): verkopen "Scrada-klaar" doorsturen (facturen/kasboek/
// Peppol). Zonder API-sleutel draait alles in TESTMODUS (dry-run).
export function Boekhouding() {
  const [status, setStatus] = useState<ScradaStatus | null>(null);
  const [open, setOpen] = useState<OpenstaandeVerkoop[]>([]);
  const [preview, setPreview] = useState<ScradaFactuur | null>(null);
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [config, setConfig] = useState<ScradaConfig | null>(null); // welke instellingen op de server staan
  const [verbinding, setVerbinding] = useState<ScradaVerbinding | null>(null);

  // Startdatum: enkel verkopen vanaf die dag gaan naar Scrada — het verleden zit
  // al in de boekhouding (dagontvangsten) en zou anders dubbel geboekt worden.
  const [vanaf, setVanaf] = useState('');
  const [vanafOpgeslagen, setVanafOpgeslagen] = useState<string | null>(null);
  const [overgeslagen, setOvergeslagen] = useState(0);
  // Automatische synchronisatie: dagelijks om autoSync (Belgische tijd) + verslag van de laatste run.
  const [sync, setSync] = useState<{ uur: string; laatste: ScradaSyncVerslag | null }>({ uur: '23:59', laatste: null });

  async function laad() {
    const s = await getScradaStatus();
    setStatus(s);
    setConfig(s.geconfigureerd ?? null);
    setVanafOpgeslagen(s.vanaf ?? null);
    setVanaf(s.vanaf ?? '');
    setOvergeslagen(s.overgeslagen ?? 0);
    setSync({ uur: s.autoSync ?? '23:59', laatste: s.laatsteSync ?? null });
    setOpen(await getScradaOpenstaande());
  }
  async function bewaarVanaf() {
    if (!vanaf) { setMelding('Kies eerst een startdatum.'); return; }
    if (!window.confirm(`Enkel verkopen vanaf ${new Date(vanaf + 'T00:00:00').toLocaleDateString('nl-BE')} naar Scrada sturen? Oudere verkopen worden nooit verstuurd.`)) return;
    setBezig(true); setMelding('');
    try { await zetScradaVanaf(vanaf); setMelding('Startdatum opgeslagen.'); await laad(); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Opslaan mislukt'); }
    finally { setBezig(false); }
  }
  async function resetStatus() {
    if (!window.confirm('Verzendstatus van alle verkopen vanaf de startdatum terug op "niet verstuurd" zetten?\n\nDoe dit enkel na het testen in de testomgeving, vóór je naar de echte Scrada overschakelt.')) return;
    setBezig(true); setMelding('');
    try { const r = await scradaResetStatus(); setMelding(`${r.aantal} verkopen terug op "niet verstuurd".`); await laad(); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Reset mislukt'); }
    finally { setBezig(false); }
  }
  // Test of Scrada de API-sleutel/wachtwoord/bedrijf aanvaardt (verstuurt niets).
  async function testVerbinding() {
    setBezig(true); setVerbinding(null);
    try { setVerbinding(await getScradaVerbinding()); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Test mislukt'); }
    finally { setBezig(false); }
  }
  useEffect(() => { laad(); }, []);

  async function toon(id: string) {
    setPreview(await getScradaPreview(id));
  }
  async function verstuurEen(id: string) {
    setBezig(true); setMelding('');
    const res = await scradaVerstuurEen(id);
    setMelding(res.modus === 'test'
      ? 'Testmodus: dit zou naar Scrada gaan (niets echt verstuurd).'
      : res.verstuurd ? `Verstuurd (ref ${res.scradaRef}).` : `Fout: ${res.fout}`);
    await laad(); setBezig(false);
  }
  async function verstuurAlles() {
    if (!window.confirm(`Alle ${open.length} openstaande verkopen (vanaf de startdatum) naar Scrada sturen?`)) return;
    setBezig(true); setMelding('');
    try {
      const res = await scradaVerstuurAlles();
      if (res.geweigerd) setMelding(res.melding ?? 'Geweigerd.');
      else setMelding(`${res.modus === 'test' ? 'Testmodus — ' : ''}${res.gevonden} gevonden, ${res.verstuurd} verstuurd${res.mislukt ? `, ${res.mislukt} mislukt (${res.fout ?? 'fout'})` : ''}.`);
      await laad();
    } catch (e) { setMelding(e instanceof Error ? e.message : 'Versturen mislukt'); }
    finally { setBezig(false); }
  }

  const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);

  return (
    <div style={{ maxWidth: 1000, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 440px' }}>
        <h2>Boekhouding — Scrada</h2>
        {status && (
          <div style={{ marginBottom: 12 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 99, fontSize: 13, fontWeight: 600,
              background: status.modus === 'live' ? '#dcfce7' : '#fef3c7',
              color: status.modus === 'live' ? '#166534' : '#92400e',
            }}>
              {status.modus === 'live'
                ? `● Gekoppeld${config?.test ? ' met de Scrada-TESTomgeving' : ' (Scrada live)'}`
                : '● Nog niet gekoppeld (dry-run)'}
            </span>
            {/* Welke serverinstellingen ontbreken (waarden zelf worden nooit getoond) */}
            {config && status.modus !== 'live' && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#92400e' }}>
                Ontbreekt op de server:{' '}
                {[!config.sleutel && 'SCRADA_API_KEY', !config.wachtwoord && 'SCRADA_API_PASSWORD', !config.bedrijf && 'SCRADA_COMPANY_ID'].filter(Boolean).join(', ') || '—'}
                {' '}· server: {config.basis}
              </div>
            )}
            <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>Nog te versturen: <strong>{status.NIET_VERSTUURD}</strong></span>
              <span style={{ color: '#166534' }}>Verstuurd: {status.VERSTUURD}</span>
              {status.FOUT > 0 && <span style={{ color: 'crimson' }}>Fout: {status.FOUT}</span>}
              <button onClick={testVerbinding} disabled={bezig} style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                Verbinding testen
              </button>
            </div>
            {verbinding && (
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: verbinding.ok ? '#166534' : 'crimson' }}>
                {verbinding.ok
                  ? `✔ Verbinding OK${verbinding.bedrijf ? ` — onderneming in Scrada: ${verbinding.bedrijf}` : ''}`
                  : `✖ ${verbinding.melding ?? 'Verbinding mislukt'}`}
              </div>
            )}
          </div>
        )}

        {/* Automatische synchronisatie: dagelijks om 23:59, verslag van de laatste run */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12, background: '#f8fafc', fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>⏰ Automatische synchronisatie: elke dag om {sync.uur}</div>
          <div style={{ color: '#6b7280', marginTop: 4 }}>
            Alle openstaande verkopen vanaf de startdatum gaan dan vanzelf naar Scrada. Tussendoor hoef je niets te doen.
            {sync.laatste
              ? <> Laatste run: <strong>{new Date(sync.laatste.moment).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}</strong>
                  {sync.laatste.geweigerd
                    ? <span style={{ color: '#b45309' }}> — niet uitgevoerd: {sync.laatste.melding}</span>
                    : <> — {sync.laatste.verstuurd ?? 0} verstuurd{(sync.laatste.mislukt ?? 0) > 0 && <span style={{ color: 'crimson' }}>, {sync.laatste.mislukt} mislukt ({sync.laatste.fout ?? 'fout'})</span>}{sync.laatste.modus === 'test' && ' (dry-run, niet gekoppeld)'}</>}
                </>
              : ' Nog geen automatische run uitgevoerd.'}
          </div>
        </div>

        {/* Startdatum: beveiliging tegen dubbel boeken van het verleden */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12, background: vanafOpgeslagen ? '#fff' : '#fef3c7' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Verstuur enkel verkopen vanaf</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            Verkopen van vóór deze datum zitten al in de boekhouding (dagontvangsten) en worden <strong>nooit</strong> naar Scrada gestuurd.
            {vanafOpgeslagen
              ? <> Ingesteld: <strong>{new Date(vanafOpgeslagen + 'T00:00:00').toLocaleDateString('nl-BE')}</strong>{overgeslagen > 0 && <> · {overgeslagen} oudere verkopen worden overgeslagen</>}.</>
              : <> <strong>Nog niet ingesteld</strong> — "Alles versturen" is daarom uitgeschakeld.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" value={vanaf} onChange={(e) => setVanaf(e.target.value)} style={{ padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }} />
            <button onClick={bewaarVanaf} disabled={bezig || !vanaf || vanaf === vanafOpgeslagen} style={btn}>Startdatum opslaan</button>
            {vanafOpgeslagen && (
              <button onClick={resetStatus} disabled={bezig} title="Na testen in de testomgeving: vanaf de startdatum alles terug op 'niet verstuurd' zetten" style={btn}>
                Verzendstatus resetten (vanaf startdatum)
              </button>
            )}
          </div>
        </div>

        <button onClick={verstuurAlles} disabled={bezig || !open.length || !vanafOpgeslagen}
          title={!vanafOpgeslagen ? 'Stel eerst de startdatum in' : undefined}
          style={{ padding: '10px 16px', border: 'none', borderRadius: 8, background: open.length && vanafOpgeslagen ? '#2563eb' : '#9ca3af', color: '#fff', fontWeight: 700, cursor: open.length && vanafOpgeslagen ? 'pointer' : 'default' }}>
          {bezig ? 'Bezig…' : `Alle openstaande versturen (${open.length})`}
        </button>
        {melding && <p style={{ color: '#374151', background: '#f3f4f6', padding: '8px 12px', borderRadius: 8 }}>{melding}</p>}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
              <th style={{ padding: 4 }}>Datum</th>
              <th style={{ padding: 4 }}>Klant</th>
              <th style={{ padding: 4, textAlign: 'right' }}>Totaal</th>
              <th style={{ padding: 4 }}>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {open.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: 4 }}>{new Date(v.datum).toLocaleString('nl-BE')}</td>
                <td style={{ padding: 4 }}>{v.klant?.naam ?? 'Particulier (kasticket)'}</td>
                <td style={{ padding: 4, textAlign: 'right' }}>{euro(v.totaal)}</td>
                <td style={{ padding: 4 }}>{v.scradaStatus === 'FOUT' ? <span style={{ color: 'crimson' }}>fout</span> : 'open'}</td>
                <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                  <button onClick={() => toon(v.id)} style={btn}>Bekijk</button>{' '}
                  <button onClick={() => verstuurEen(v.id)} disabled={bezig} style={btn}>Verstuur</button>
                </td>
              </tr>
            ))}
            {open.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: '#999' }}>Niets openstaand — alles is verstuurd.</td></tr>}
          </tbody>
        </table>
      </div>

      {preview && (
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ border: '1px solid #ddd', borderRadius: 10, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Scrada-payload</h3>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
              Type: <strong>{preview.type === 'peppol_factuur' ? 'Peppol-factuur (B2B)' : 'Kasticket (kasboek)'}</strong><br />
              Onderneming: {preview.onderneming.naam}<br />
              Klant: {preview.klant?.naam ?? 'particulier'}<br />
              Betaalwijze: {preview.betaalwijze} · Kanaal: {preview.kanaal}
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {preview.lijnen.map((l, i) => (
                  <tr key={i}><td>{l.aantal}× {l.omschrijving}</td><td style={{ textAlign: 'right' }}>{euro(l.totaalInclBtw)}</td></tr>
                ))}
              </tbody>
            </table>
            <hr />
            {preview.btwPerTarief.map((b) => (
              <div key={b.percentage} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }}>
                <span>BTW {b.percentage}% (maatstaf {euro(b.maatstaf)})</span><span>{euro(b.btw)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 6 }}>
              <span>Totaal incl. BTW</span><span>{euro(preview.totaalInclBtw)}</span>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Ruwe JSON</summary>
              <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(preview, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

const btn: CSSProperties = { padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
