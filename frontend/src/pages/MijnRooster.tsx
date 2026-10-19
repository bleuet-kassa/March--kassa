import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getMijnRooster, type Dienst } from '../api/client';

// Mijn rooster: elke medewerker ziet hier zijn eigen diensten voor de komende weken
// (enkel raadplegen; de planning zelf wordt gemaakt op het Planning-scherm).
const LOC: Record<string, [string, string]> = { WINKEL: ['Winkel', '#2563eb'], RESTAURANT: ['Restaurant', '#b45309'], CATERING: ['Catering', '#7c3aed'] };
const vanIso = (s: string) => new Date(s + 'T12:00:00');
const plusDagen = (s: string, n: number) => { const d = vanIso(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const uren = (n: number) => `${Math.floor(n)}u${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;

export function MijnRooster() {
  const [weken, setWeken] = useState(4);
  const [data, setData] = useState<Awaited<ReturnType<typeof getMijnRooster>> | null>(null);
  const [fout, setFout] = useState('');

  useEffect(() => {
    getMijnRooster(weken).then(setData).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'));
  }, [weken]);

  const perWeek = useMemo(() => {
    if (!data) return [];
    const uit: { maandag: string; dagen: { dag: string; diensten: Dienst[] }[]; totaal: number }[] = [];
    for (let w = 0; w < weken; w++) {
      const maandag = plusDagen(data.van, w * 7);
      const dagen = Array.from({ length: 7 }, (_, i) => { const dag = plusDagen(maandag, i); return { dag, diensten: data.diensten.filter((d) => d.dag === dag) }; });
      uit.push({ maandag, dagen, totaal: dagen.reduce((s, d) => s + d.diensten.reduce((t, x) => t + x.uren, 0), 0) });
    }
    return uit;
  }, [data, weken]);

  if (fout) return <p style={{ color: 'crimson' }}>{fout}</p>;
  if (!data) return <p>Laden…</p>;
  const volgende = data.diensten.find((d) => d.dag >= data.vandaag);

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Mijn rooster</h2>
        <span style={{ color: '#6b7280' }}>{data.naam}</span>
        <label style={{ marginLeft: 'auto', fontSize: 14 }}>Toon{' '}
          <select value={weken} onChange={(e) => setWeken(Number(e.target.value))} style={{ padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}>
            {[2, 4, 6, 8].map((n) => <option key={n} value={n}>{n} weken</option>)}
          </select>
        </label>
      </div>

      {volgende ? (
        <div style={{ margin: '12px 0', padding: '12px 16px', borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 13, color: '#1d4ed8' }}>{volgende.dag === data.vandaag ? 'Vandaag' : 'Volgende dienst'}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {vanIso(volgende.dag).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · {volgende.start} – {volgende.eind}
          </div>
          <div style={{ fontSize: 14, color: '#374151' }}>{volgende.locatie ? LOC[volgende.locatie]?.[0] : ''}{volgende.opmerking ? ` · ${volgende.opmerking}` : ''}</div>
        </div>
      ) : (
        <p style={{ color: '#6b7280', margin: '12px 0' }}>Er zijn nog geen diensten voor je ingepland in deze periode.</p>
      )}

      {perWeek.map((w) => (
        <section key={w.maandag} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #e5e7eb', padding: '4px 0', marginBottom: 6 }}>
            <strong>Week van {vanIso(w.maandag).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</strong>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#374151' }}>
              {uren(w.totaal)}{data.urenPerWeek != null ? <span style={{ color: '#6b7280' }}> / {uren(data.urenPerWeek)} normaal</span> : ''}
            </span>
          </div>
          {w.dagen.map(({ dag, diensten }) => {
            const vandaag = dag === data.vandaag;
            const voorbij = dag < data.vandaag;
            return (
              <div key={dag} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 8px', borderRadius: 8, background: vandaag ? '#eff6ff' : undefined, opacity: voorbij ? .5 : 1 }}>
                <div style={{ width: 92, flex: 'none', fontWeight: vandaag ? 700 : 500, textTransform: 'capitalize' }}>
                  {vanIso(dag).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {diensten.length === 0 && <span style={{ color: '#b0b4b8' }}>vrij</span>}
                  {diensten.map((d) => {
                    const [lnaam, kleur] = d.locatie ? LOC[d.locatie] ?? [d.locatie, '#374151'] : ['', '#374151'];
                    return (
                      <div key={d.id} style={{ borderLeft: `4px solid ${kleur}`, paddingLeft: 8 }}>
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{d.start} – {d.eind}</span>
                        <span style={{ color: '#6b7280' }}> · {uren(d.uren)}{d.pauzeMin ? ` (${d.pauzeMin} min pauze)` : ''}{lnaam ? ` · ${lnaam}` : ''}</span>
                        {d.opmerking && <div style={{ fontSize: 13, color: '#374151' }}>{d.opmerking}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <p style={hint}>Klopt er iets niet in je rooster? Spreek je verantwoordelijke aan; die kan het aanpassen.</p>
    </div>
  );
}

const hint: CSSProperties = { fontSize: 13, color: '#6b7280' };
