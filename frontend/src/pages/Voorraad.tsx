import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getVoorraad, getMeta, getVoorraadAlarm, controleerTht, zetVoorraadInstellingen,
  type VoorraadLijst, type VoorraadAlarm, type Afdeling,
} from '../api/client';
import { getVerkoper } from '../auth';
import { isAdminRol } from '../rechten';
import { VoorraadDetail, ThtLabel, datumNl, hoeveelheid } from './VoorraadDetail';

const FILTERS: [string, string][] = [['', 'Alles'], ['alarm', 'THT-alarm'], ['voorraad', 'Met voorraad'], ['negatief', 'Onder nul'], ['zonderTht', 'Zonder THT']];

// Centrale voorraadlijst: per artikel de actuele voorraad per locatie (de kassa trekt bij elke
// verkoop af), de eerstvolgende THT van wat er nog ligt, en het THT-alarm. Klik een artikel
// voor ontvangen, afboeken, tellen en de ontvangsten.
export function Voorraad() {
  const [params] = useSearchParams();
  const [zoek, setZoek] = useState('');
  const [afdelingId, setAfdelingId] = useState('');
  const [filter, setFilter] = useState(params.get('alarm') ? 'alarm' : '');
  const [data, setData] = useState<VoorraadLijst | null>(null);
  const [afdelingen, setAfdelingen] = useState<Afdeling[]>([]);
  const [open, setOpen] = useState<{ id: string; naam: string } | null>(null);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [laatste, setLaatste] = useState<VoorraadAlarm['laatsteControle']>(null);
  const isAdmin = isAdminRol(getVerkoper()?.rol ?? '');

  // Enkel het antwoord op de laatste vraag tonen: een trager antwoord voor een oudere zoekterm of
  // filter mag de lijst niet overschrijven.
  const verzoek = useRef(0);
  function laad() {
    const nr = ++verzoek.current;
    getVoorraad(zoek, afdelingId, filter)
      .then((d) => { if (nr === verzoek.current) { setData(d); setFout(''); } })
      .catch((e) => { if (nr === verzoek.current) setFout(e instanceof Error ? e.message : 'Laden mislukt'); });
  }
  useEffect(() => { const t = setTimeout(laad, 200); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [zoek, afdelingId, filter]);
  useEffect(() => {
    getMeta().then((m) => setAfdelingen(m.afdelingen ?? [])).catch(() => {});
    getVoorraadAlarm().then((a) => setLaatste(a.laatsteControle)).catch(() => {});
  }, []);

  // Kolommen: de winkel altijd, andere locaties enkel als er iets ligt.
  const kolommen = useMemo(() => (data ? data.locaties.filter((l) => l.type === 'WINKEL' || data.rijen.some((r) => r.perLocatie[l.id])) : []), [data]);

  async function nuControleren() {
    setMelding(''); setFout('');
    try {
      const r = await controleerTht();
      setMelding(`Controle klaar: ${r.verlopen.length} over de THT, ${r.bijna.length} binnenkort. ${r.verstuurd ? `Melding verstuurd naar ${r.verstuurd} toestel${r.verstuurd === 1 ? '' : 'len'}.` : 'Geen melding verstuurd.'}`);
      getVoorraadAlarm().then((a) => setLaatste(a.laatsteControle)).catch(() => {});
      window.dispatchEvent(new Event('voorraad-gewijzigd'));
    } catch (e) { setFout(e instanceof Error ? e.message : 'Controleren mislukt'); }
  }
  async function zetAlarmDagen(n: number) {
    setFout('');
    try { await zetVoorraadInstellingen(n); laad(); window.dispatchEvent(new Event('voorraad-gewijzigd')); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }

  const alarm = data ? data.telling.verlopen + data.telling.bijna : 0;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h2 style={{ marginBottom: 4 }}>Voorraad</h2>
      <p style={{ color: '#6b7280', marginTop: 0, fontSize: 14 }}>
        De kassa trekt bij elke verkoop af. Ontvangsten geef je per artikel in, met ontvangstdatum en THT.
        Elke ochtend telt het systeem op de achtergrond wat er nog ligt en stuurt het een melding als een THT (bijna) verstrijkt.
      </p>

      {data && alarm > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>THT-alarm</strong>
          <span>
            {data.telling.verlopen > 0 && `${data.telling.verlopen} ${data.telling.verlopen === 1 ? 'artikel' : 'artikels'} over de THT`}
            {data.telling.verlopen > 0 && data.telling.bijna > 0 && ', '}
            {data.telling.bijna > 0 && `${data.telling.bijna} binnen ${data.alarmDagen} ${data.alarmDagen === 1 ? 'dag' : 'dagen'}`}
          </span>
          {filter !== 'alarm' && <button onClick={() => setFilter('alarm')} style={knopKlein}>Toon</button>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek op naam of barcode…" style={{ ...inp, width: 240 }} />
        <select value={afdelingId} onChange={(e) => setAfdelingId(e.target.value)} style={inp} aria-label="Afdeling">
          <option value="">Alle afdelingen</option>
          {afdelingen.map((a) => <option key={a.id} value={a.id}>{a.naam}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, naam]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} style={chip(filter === k)}>{naam}</button>
          ))}
        </div>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534' }}>{melding}</p>}

      {!data ? <div style={{ color: '#6b7280' }}>Laden…</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: 12, borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Artikel</th>
                {kolommen.map((l) => <th key={l.id} style={{ ...th, textAlign: 'right' }}>{l.naam}</th>)}
                {kolommen.length > 1 && <th style={{ ...th, textAlign: 'right' }}>Totaal</th>}
                <th style={th}>Eerstvolgende THT</th>
                <th style={th}>Laatste ontvangst</th>
              </tr>
            </thead>
            <tbody>
              {data.rijen.map((r) => (
                <tr key={r.id} onClick={() => setOpen({ id: r.id, naam: r.naam })} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{r.naam}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {r.afdeling ?? 'zonder afdeling'}
                      {!r.thtNodig && ' · geen THT'}
                      {r.thtNodig && r.zonderTht > 0 && <span style={{ color: '#92400e' }}> · {hoeveelheid(r.zonderTht, r.eenheid)} zonder THT</span>}
                    </div>
                  </td>
                  {kolommen.map((l) => {
                    const n = r.perLocatie[l.id] ?? 0;
                    return <td key={l.id} style={{ ...td, textAlign: 'right', color: n < 0 ? '#b91c1c' : n === 0 ? '#9ca3af' : undefined, fontWeight: n < 0 ? 700 : 400 }}>{hoeveelheid(n, r.eenheid)}</td>;
                  })}
                  {kolommen.length > 1 && <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{hoeveelheid(r.totaal, r.eenheid)}</td>}
                  <td style={td}>{r.eerstvolgendeTht ? <>{datumNl(r.eerstvolgendeTht)} <ThtLabel status={r.status} dagen={r.dagenTotTht} /></> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{r.laatsteOntvangst ? datumNl(r.laatsteOntvangst) : '—'}</td>
                </tr>
              ))}
              {data.rijen.length === 0 && <tr><td colSpan={kolommen.length + 4} style={{ padding: 16, color: '#9ca3af' }}>Geen artikels gevonden.</td></tr>}
            </tbody>
          </table>
          {data.afgekapt && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Enkel de eerste 3000 artikels; zoek of filter om de rest te zien.</div>}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Laatste THT-controle: {laatste ? `${new Date(laatste.moment).toLocaleString('nl-BE')} (${laatste.verlopen} over de THT, ${laatste.bijna} binnenkort)` : 'nog niet uitgevoerd (elke ochtend vanaf 7 uur)'}</span>
        {isAdmin && (
          <>
            <button onClick={nuControleren} style={knopKlein}>Nu controleren</button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Alarm
              <select value={data?.alarmDagen ?? 3} onChange={(e) => zetAlarmDagen(Number(e.target.value))} style={{ ...inp, padding: 4 }}>
                {[0, 1, 2, 3, 4, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n === 0 ? 'enkel na de THT' : `${n} ${n === 1 ? 'dag' : 'dagen'} vooraf`}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Voorraad van ${open.naam}`}
            style={{ background: '#fff', width: 'min(760px, 100vw)', height: '100%', overflowY: 'auto', padding: 18, boxSizing: 'border-box', boxShadow: '-8px 0 24px rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <h3 style={{ margin: 0, flex: 1 }}>{open.naam}</h3>
              <button onClick={() => setOpen(null)} style={knopKlein}>Sluiten</button>
            </div>
            <VoorraadDetail productId={open.id} onGewijzigd={laad} />
          </div>
        </div>
      )}
    </div>
  );
}

const inp: CSSProperties = { padding: 7, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box' };
const chip = (aan: boolean): CSSProperties => ({ padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: aan ? '2px solid #0d4589' : '1px solid #cbd5e1', background: aan ? '#eff6ff' : '#fff', fontWeight: aan ? 700 : 500, fontSize: 13 });
const knopKlein: CSSProperties = { padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const th: CSSProperties = { padding: '6px 6px' };
const td: CSSProperties = { padding: '7px 6px', verticalAlign: 'top' };
