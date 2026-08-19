import { useEffect, useState, type CSSProperties } from 'react';
import {
  getSiteInhoud, zetSiteTeksten, zetOpeningsuren, nieuwePartner, updatePartner, verwijderPartner,
  uploadSiteAfbeelding,
  type SiteInhoud, type Openingsuur, type SitePartner,
} from '../api/client';

const DAGEN = ['', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const AANBOD_TILES: { slug: string; naam: string }[] = [
  { slug: 'fruit', naam: 'Fruit' }, { slug: 'groenten', naam: 'Groenten' }, { slug: 'vlees', naam: 'Vlees' },
  { slug: 'vis', naam: 'Vis' }, { slug: 'kaas', naam: 'Kaas & Zuivel' }, { slug: 'traiteur', naam: 'Traiteur' },
  { slug: 'droge', naam: 'Droge voeding' }, { slug: 'wijnkelder', naam: 'Wijnkelder' },
];
function parseGalerij(w: string | undefined): string[] {
  if (!w) return [];
  try { const v = JSON.parse(w); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
type Veld = { groep: string } | { sleutel: string; label: string; groot?: boolean };
const TEKSTVELDEN: Veld[] = [
  { groep: 'Bovenaan (hero)' },
  { sleutel: 'hero_eyebrow', label: 'Labeltekst bovenaan' },
  { sleutel: 'hero_titel', label: 'Titel (deel 1)' },
  { sleutel: 'hero_titel_accent', label: 'Titel (accent, in kleur)' },
  { sleutel: 'hero_intro', label: 'Introtekst', groot: true },
  { groep: 'Kwaliteitslabels (3 blokjes onder de titel)' },
  { sleutel: 'trust1_titel', label: 'Label 1 — titel' },
  { sleutel: 'trust1_sub', label: 'Label 1 — subtekst' },
  { sleutel: 'trust2_titel', label: 'Label 2 — titel' },
  { sleutel: 'trust2_sub', label: 'Label 2 — subtekst' },
  { sleutel: 'trust3_titel', label: 'Label 3 — titel' },
  { sleutel: 'trust3_sub', label: 'Label 3 — subtekst' },
  { groep: 'Kaartjes "Vers vandaag" (rechts bovenaan)' },
  { sleutel: 'ribbon', label: 'Badge-tekst' },
  { sleutel: 'card1_naam', label: 'Kaart 1 — naam' },
  { sleutel: 'card1_sub', label: 'Kaart 1 — subtekst' },
  { sleutel: 'card1_prijs', label: 'Kaart 1 — prijs' },
  { sleutel: 'card2_naam', label: 'Kaart 2 — naam' },
  { sleutel: 'card2_sub', label: 'Kaart 2 — subtekst' },
  { sleutel: 'card2_prijs', label: 'Kaart 2 — prijs' },
  { sleutel: 'card3_naam', label: 'Kaart 3 — naam' },
  { sleutel: 'card3_sub', label: 'Kaart 3 — subtekst' },
  { sleutel: 'card3_prijs', label: 'Kaart 3 — prijs' },
  { groep: 'Ons aanbod' },
  { sleutel: 'aanbod_titel', label: 'Titel' },
  { sleutel: 'aanbod_intro', label: 'Introtekst', groot: true },
  { groep: 'Webshop-blok' },
  { sleutel: 'webshop_titel', label: 'Titel (deel 1)' },
  { sleutel: 'webshop_titel_accent', label: 'Titel (accent, in kleur)' },
  { sleutel: 'webshop_intro', label: 'Introtekst', groot: true },
  { groep: 'Contact' },
  { sleutel: 'contact_adres', label: 'Adres' },
  { sleutel: 'contact_telefoon', label: 'Telefoon' },
  { sleutel: 'contact_email', label: 'E-mail' },
];

// Website-beheer: teksten, openingsuren en partners van de publieke site zelf
// aanpassen. Wat je hier bewaart, verschijnt meteen op marché.eu.
export function Website() {
  const [teksten, setTeksten] = useState<Record<string, string>>({});
  const [heroFoto, setHeroFoto] = useState('');
  const [aanbodFotos, setAanbodFotos] = useState<Record<string, string>>({});
  const [galerij, setGalerij] = useState<string[]>([]);
  const [uren, setUren] = useState<Openingsuur[]>([]);
  const [partners, setPartners] = useState<SitePartner[]>([]);
  const [pNaam, setPNaam] = useState('');
  const [pWebsite, setPWebsite] = useState('');
  const [melding, setMelding] = useState('');
  const [fout, setFout] = useState('');

  function vulIn(i: SiteInhoud) {
    const t: Record<string, string> = {};
    for (const v of TEKSTVELDEN) if ('sleutel' in v) t[v.sleutel] = i.teksten[v.sleutel] ?? '';
    setTeksten(t);
    setHeroFoto(i.teksten['hero_afbeelding'] ?? '');
    const af: Record<string, string> = {};
    for (const t of AANBOD_TILES) af[t.slug] = i.teksten[`aanbodfoto_${t.slug}`] ?? '';
    setAanbodFotos(af);
    setGalerij(parseGalerij(i.teksten['galerij']));
    // Zorg dat er altijd 7 dagen zijn.
    const perDag = new Map(i.openingsuren.map((u) => [u.dag, u]));
    setUren(Array.from({ length: 7 }, (_, k) => perDag.get(k + 1) ?? { id: '', dag: k + 1, gesloten: false, van: '', tot: '' }));
    setPartners(i.partners);
  }
  async function laad() { vulIn(await getSiteInhoud()); }
  useEffect(() => { laad(); }, []);

  function flits(m: string) { setMelding(m); setTimeout(() => setMelding(''), 2500); }

  async function bewaarTeksten() {
    setFout('');
    try { await zetSiteTeksten(teksten); flits('Teksten bewaard.'); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }
  async function bewaarUren() {
    setFout('');
    try {
      const rijen = uren.map((u) => ({ dag: u.dag, gesloten: u.gesloten, van: u.van || null, tot: u.tot || null }));
      const nieuw = await zetOpeningsuren(rijen);
      setUren(nieuw);
      flits('Openingsuren bewaard.');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
  }
  async function voegPartnerToe() {
    if (!pNaam.trim()) return;
    setFout('');
    try {
      await nieuwePartner({ naam: pNaam.trim(), website: pWebsite.trim() || null, volgorde: partners.length });
      setPNaam(''); setPWebsite('');
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Toevoegen mislukt'); }
  }
  async function uploadHero(bestand: File | undefined) {
    if (!bestand) return;
    setFout('');
    try {
      const { url } = await uploadSiteAfbeelding(bestand);
      await zetSiteTeksten({ hero_afbeelding: url });
      setHeroFoto(url);
      flits('Hero-foto bewaard.');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Uploaden mislukt'); }
  }
  async function verwijderHero() {
    await zetSiteTeksten({ hero_afbeelding: '' });
    setHeroFoto('');
    flits('Hero-foto verwijderd.');
  }
  async function uploadAanbodFoto(slug: string, bestand: File | undefined) {
    if (!bestand) return;
    setFout('');
    try {
      const { url } = await uploadSiteAfbeelding(bestand);
      await zetSiteTeksten({ [`aanbodfoto_${slug}`]: url });
      setAanbodFotos((a) => ({ ...a, [slug]: url }));
      flits('Foto bewaard.');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Uploaden mislukt'); }
  }
  async function verwijderAanbodFoto(slug: string) {
    await zetSiteTeksten({ [`aanbodfoto_${slug}`]: '' });
    setAanbodFotos((a) => ({ ...a, [slug]: '' }));
    flits('Foto verwijderd.');
  }
  async function uploadGalerij(bestand: File | undefined) {
    if (!bestand) return;
    setFout('');
    try {
      const { url } = await uploadSiteAfbeelding(bestand);
      const nieuw = [...galerij, url];
      await zetSiteTeksten({ galerij: JSON.stringify(nieuw) });
      setGalerij(nieuw);
      flits('Foto toegevoegd.');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Uploaden mislukt'); }
  }
  async function verwijderGalerijFoto(url: string) {
    const nieuw = galerij.filter((u) => u !== url);
    await zetSiteTeksten({ galerij: JSON.stringify(nieuw) });
    setGalerij(nieuw);
  }

  async function uploadPartnerLogo(p: SitePartner, bestand: File | undefined) {
    if (!bestand) return;
    setFout('');
    try {
      const { url } = await uploadSiteAfbeelding(bestand);
      await updatePartner(p.id, { logoUrl: url });
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Uploaden mislukt'); }
  }

  async function schrapPartner(id: string) { await verwijderPartner(id); await laad(); }
  async function hernoemPartner(p: SitePartner, naam: string) {
    setPartners((ps) => ps.map((x) => (x.id === p.id ? { ...x, naam } : x)));
  }
  async function bewaarPartner(p: SitePartner) { await updatePartner(p.id, { naam: p.naam, website: p.website }); flits('Partner bewaard.'); }

  return (
    <div style={{ maxWidth: 760 }}>
      <h2>Website</h2>
      <p style={{ color: '#6b7280', marginTop: 4 }}>Pas de inhoud van de publieke site aan. Wijzigingen verschijnen meteen op de site.</p>
      {melding && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, margin: '10px 0' }}>{melding}</div>}
      {fout && <div style={{ color: 'crimson', margin: '10px 0' }}>{fout}</div>}

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Teksten</h3>
        {TEKSTVELDEN.map((v, idx) => (
          'groep' in v ? (
            <div key={'g' + idx} style={{ fontWeight: 700, color: '#0d4589', margin: idx === 0 ? '0 0 8px' : '20px 0 8px', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>{v.groep}</div>
          ) : (
            <div key={v.sleutel} style={{ marginBottom: 12 }}>
              <div style={muted}>{v.label}</div>
              {v.groot
                ? <textarea value={teksten[v.sleutel] ?? ''} onChange={(e) => setTeksten({ ...teksten, [v.sleutel]: e.target.value })} rows={3} style={{ ...inp, width: '100%', resize: 'vertical' }} />
                : <input value={teksten[v.sleutel] ?? ''} onChange={(e) => setTeksten({ ...teksten, [v.sleutel]: e.target.value })} style={{ ...inp, width: '100%' }} />}
            </div>
          )
        ))}
        <button onClick={bewaarTeksten} style={btnBlauw}>Teksten bewaren</button>
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Foto's</h3>
        <div style={muted}>Hero-foto (grote sfeerfoto bovenaan). Vervangt de kaartjes rechts.</div>
        {heroFoto
          ? <div style={{ marginTop: 8 }}>
              <img src={heroFoto} alt="Hero" style={{ maxWidth: 320, width: '100%', borderRadius: 10, border: '1px solid #e5e7eb', display: 'block' }} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <label style={{ ...btnMini, cursor: 'pointer' }}>Vervangen<input type="file" accept="image/*" hidden onChange={(e) => uploadHero(e.target.files?.[0])} /></label>
                <button onClick={verwijderHero} style={{ ...btnMini, color: 'crimson' }}>Verwijderen</button>
              </div>
            </div>
          : <label style={{ ...btnBlauw, display: 'inline-block', cursor: 'pointer', marginTop: 8 }}>Foto kiezen<input type="file" accept="image/*" hidden onChange={(e) => uploadHero(e.target.files?.[0])} /></label>}
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Foto per afdeling ("Ons aanbod")</h3>
        <div style={muted}>Zonder foto toont de tegel een icoontje.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 10 }}>
          {AANBOD_TILES.map((t) => (
            <div key={t.slug} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.naam}</div>
              {aanbodFotos[t.slug]
                ? <img src={aanbodFotos[t.slug]} alt={t.naam} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8 }} />
                : <div style={{ height: 90, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'grid', placeItems: 'center', color: '#9ca3af', fontSize: 13 }}>geen foto</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <label style={{ ...btnMini, cursor: 'pointer' }}>{aanbodFotos[t.slug] ? 'Vervangen' : 'Kiezen'}<input type="file" accept="image/*" hidden onChange={(e) => uploadAanbodFoto(t.slug, e.target.files?.[0])} /></label>
                {aanbodFotos[t.slug] && <button onClick={() => verwijderAanbodFoto(t.slug)} style={{ ...btnMini, color: 'crimson' }}>×</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Sfeerfoto's (galerij)</h3>
        <div style={muted}>Een strook foto's op de landingspagina. Leeg = de strook wordt niet getoond.</div>
        <label style={{ ...btnBlauw, display: 'inline-block', cursor: 'pointer', margin: '10px 0' }}>Foto toevoegen<input type="file" accept="image/*" hidden onChange={(e) => uploadGalerij(e.target.files?.[0])} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {galerij.map((url) => (
            <div key={url} style={{ position: 'relative' }}>
              <img src={url} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <button onClick={() => verwijderGalerijFoto(url)} title="Verwijderen" style={{ position: 'absolute', top: 4, right: 4, border: 'none', borderRadius: 6, background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', width: 24, height: 24 }}>×</button>
            </div>
          ))}
          {galerij.length === 0 && <div style={{ color: '#999' }}>Nog geen sfeerfoto's.</div>}
        </div>
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Openingsuren</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {uren.map((u, i) => (
              <tr key={u.dag} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '8px 6px', width: 120 }}>{DAGEN[u.dag]}</td>
                <td style={{ padding: '8px 6px', width: 110 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
                    <input type="checkbox" checked={u.gesloten} onChange={(e) => setUren(uren.map((x, k) => k === i ? { ...x, gesloten: e.target.checked } : x))} />
                    gesloten
                  </label>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {!u.gesloten && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="time" value={u.van ?? ''} onChange={(e) => setUren(uren.map((x, k) => k === i ? { ...x, van: e.target.value } : x))} style={{ ...inp, marginBottom: 0 }} />
                      <span>tot</span>
                      <input type="time" value={u.tot ?? ''} onChange={(e) => setUren(uren.map((x, k) => k === i ? { ...x, tot: e.target.value } : x))} style={{ ...inp, marginBottom: 0 }} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={bewaarUren} style={{ ...btnBlauw, marginTop: 12 }}>Openingsuren bewaren</button>
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Partners</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div><div style={muted}>Naam</div><input value={pNaam} onChange={(e) => setPNaam(e.target.value)} style={{ ...inp, width: 200 }} /></div>
          <div><div style={muted}>Website (optioneel)</div><input value={pWebsite} onChange={(e) => setPWebsite(e.target.value)} placeholder="https://…" style={{ ...inp, width: 220 }} /></div>
          <button onClick={voegPartnerToe} style={btnBlauw}>Toevoegen</button>
        </div>
        {partners.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #f0f0f0', padding: '6px 0' }}>
            {p.logoUrl
              ? <img src={p.logoUrl} alt={p.naam} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6, border: '1px solid #e5e7eb' }} />
              : <span style={{ width: 40, height: 40, borderRadius: 6, border: '1px dashed #cbd5e1', display: 'inline-block' }} />}
            <input value={p.naam} onChange={(e) => hernoemPartner(p, e.target.value)} style={{ ...inp, marginBottom: 0, width: 170 }} />
            <input value={p.website ?? ''} onChange={(e) => setPartners(partners.map((x) => x.id === p.id ? { ...x, website: e.target.value } : x))} placeholder="https://…" style={{ ...inp, marginBottom: 0, flex: 1 }} />
            <label style={{ ...btnMini, cursor: 'pointer' }}>Logo…<input type="file" accept="image/*" hidden onChange={(e) => uploadPartnerLogo(p, e.target.files?.[0])} /></label>
            <button onClick={() => bewaarPartner(p)} style={btnMini}>Bewaren</button>
            <button onClick={() => schrapPartner(p.id)} style={{ ...btnMini, color: 'crimson' }}>×</button>
          </div>
        ))}
        {partners.length === 0 && <div style={{ color: '#999' }}>Nog geen partners.</div>}
      </section>
    </div>
  );
}

const kaart: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, margin: '16px 0' };
const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
