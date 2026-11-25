import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  getMeta, getProductenBeheer, factuurInlezen, factuurVerwerken, createLeverancier,
  type Meta, type ProductVol, type InleesResultaat, type InleesRegel, type VerwerkRegel, type VerwerkResultaat, type ApiFout,
} from '../api/client';
import { maakZoekIndex, zoekOpNaam, zoektOpNaam, woordenVan, type ZoekIndex } from '../kassaZoeken';
import { thtStandaard } from '../tht';

// Eén factuurlijn zoals de gebruiker ze nakijkt.
type Rij = {
  key: number;
  omschrijving: string; // zoals op de factuur
  voorWinkel: boolean; // uit = niet in de kassa en niet in de voorraad (onthouden)
  productId: string | null; // bestaand artikel; leeg = nieuw artikel
  waarom: 'vorige' | 'voorstel' | null; // waarom dit artikel al klaarstaat
  voorstellen: string[]; // andere artikels met een gelijkaardige naam
  aantal: string; // zoals gefactureerd (bv. 2 trays)
  inkoop: string; // zoals gefactureerd (per tray), zonder btw
  per: string; // stuks per tray/doos
  perKeuze: { factuur: number; vorige: number } | null; // factuur en vorige keer verschillen: eerst kiezen
  tht: string;
  // enkel voor een nieuw artikel
  naam: string;
  factor: string;
  verkoop: string;
  btwTariefId: string;
  afdelingId: string;
  isAlcohol: boolean;
  alcoholZelf: boolean; // zelf aangevinkt: niet meer automatisch aanpassen
};
type Kop = { sleutel: string; bestandHash: string; factuurdatum: string | null; eerder: InleesResultaat['eerderVerwerkt']; bron: 'ai' | 'lokaal' };
type Standaard = { afdelingId: string; factor: string; btwTariefId: string };

const vandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const getal = (s: string) => (String(s).trim() === '' ? NaN : Number(String(s).trim().replace(',', '.')));
const metKomma = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');
const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;
const datumNl = (d: string) => new Date(d).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' });
// Zelfde rekenregel als de server: aankoop × factor, naar boven op 5 cent.
function prijsUitFactor(aankoop: number, factor: number) {
  const cent = Math.round(aankoop * factor * 100 * 1000) / 1000;
  return (Math.ceil(cent / 5 - 1e-9) * 5) / 100;
}
// Alcohol (leeftijdscontrole aan de kassa): standaard in de wijnkelder, behalve alcoholvrij en toebehoren.
const GEEN_ALCOHOL = /(^|[^0-9.,])0 ?%|non[ -]?alcoholic|alcoholvrij|alcohol[ -]?free|coravin|vacu ?vin/i;
const alcoholStandaard = (afdeling: string | undefined, naam: string) => /^wijn/i.test(afdeling ?? '') && !GEEN_ALCOHOL.test(naam);
function meestGebruikt(xs: (string | null | undefined)[]): string | undefined {
  const tel = new Map<string, number>();
  for (const x of xs) if (x) tel.set(x, (tel.get(x) ?? 0) + 1);
  let beste: string | undefined, n = 0;
  tel.forEach((c, x) => { if (c > n) { n = c; beste = x; } });
  return beste;
}

// Aankoopfacturen inlezen: per lijn kiezen of het voor de winkel is, en welk artikel het is (een
// bestaand artikel bijboeken, of een nieuw aanmaken met afdeling en factor), met THT. De kassa
// onthoudt de keuzes per leverancier, en verwerkt dezelfde factuur geen twee keer.
export function Facturen() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [producten, setProducten] = useState<ProductVol[] | null>(null);
  const [laadFout, setLaadFout] = useState('');
  const [bezig, setBezig] = useState<'' | 'inlezen' | 'verwerken'>('');
  const [fout, setFout] = useState('');
  const [foutRegel, setFoutRegel] = useState<number | null>(null);
  const [melding, setMelding] = useState('');
  const [kop, setKop] = useState<Kop | null>(null);
  const [leverancierId, setLeverancierId] = useState('');
  const [leverancierOpFactuur, setLeverancierOpFactuur] = useState('');
  const [nieuweLeverancier, setNieuweLeverancier] = useState<string | null>(null);
  const [factuurnummer, setFactuurnummer] = useState('');
  const [ontvangenOp, setOntvangenOp] = useState(vandaag());
  const [locatieId, setLocatieId] = useState('');
  const [rijen, setRijen] = useState<Rij[]>([]);
  const [toch, setToch] = useState(false);
  const [prijsOk, setPrijsOk] = useState(false);
  const [bevestig, setBevestig] = useState<{ code: string; tekst: string } | null>(null);
  const [toonFouten, setToonFouten] = useState(false);
  const [klaar, setKlaar] = useState<VerwerkResultaat | null>(null);
  const [bulkAfdeling, setBulkAfdeling] = useState('');
  const [bulkFactor, setBulkFactor] = useState('');
  const verwerkBezig = useRef(false);

  useEffect(() => {
    Promise.all([getMeta(), getProductenBeheer('')])
      .then(([m, p]) => {
        setMeta(m); setProducten(p);
        // De winkel: daar trekt de kassa af. Niet zomaar de eerste in het alfabet (Restaurant).
        setLocatieId(m.locaties.find((l) => l.type === 'WINKEL')?.id ?? m.locaties[0]?.id ?? '');
      })
      .catch((e) => setLaadFout(e instanceof Error ? e.message : 'Laden mislukt'));
  }, []);

  const perId = useMemo(() => new Map((producten ?? []).map((p) => [p.id, p])), [producten]);
  const index = useMemo(() => maakZoekIndex(producten ?? []), [producten]);
  // Artikels op naam (zonder hoofdletters, accenten en leestekens): een nieuw artikel met precies
  // dezelfde naam als een bestaand artikel is bijna altijd een dubbel.
  const perNaam = useMemo(() => new Map((producten ?? []).filter((p) => !p.vrijePrijs && !p.isStatiegeld).map((p) => [woordenVan(p.naam).join(' '), p])), [producten]);
  const afdelingNaam = (id: string) => meta?.afdelingen.find((a) => a.id === id)?.naam;
  const thtNodig = (r: Rij) => (r.productId ? perId.get(r.productId)?.thtNodig ?? true : thtStandaard(afdelingNaam(r.afdelingId), null, r.naam));

  // Standaard voor nieuwe artikels: zoals de meeste artikels van deze leverancier.
  function standaardVoor(levId: string | null, m: Meta, ps: ProductVol[]): Standaard {
    const eigen = levId ? ps.filter((p) => p.leverancierId === levId) : [];
    const factor = meestGebruikt(eigen.map((p) => p.factor));
    const btw21 = m.btwTarieven.find((b) => Number(b.percentage) === 21)?.id ?? m.btwTarieven[0]?.id ?? '';
    return {
      afdelingId: meestGebruikt(eigen.map((p) => p.afdelingId)) ?? '',
      factor: factor ? metKomma(Number(factor)) : '',
      btwTariefId: meestGebruikt(eigen.map((p) => p.btwTariefId)) ?? btw21,
    };
  }

  function naarRij(r: InleesRegel, key: number, std: Standaard, m: Meta, kaart: Map<string, ProductVol>): Rij {
    // Onthouden bij deze leverancier: zo overnemen. Onthouden bij een andere leverancier: enkel het
    // artikel, als voorstel (geen "niet voor de winkel" en geen verpakking van een ander overnemen).
    const k = r.koppeling;
    const eigen = k?.zelfdeLeverancier ? k : null;
    const vorige = eigen && !eigen.nietVoorWinkel && eigen.productId && kaart.has(eigen.productId) ? eigen.productId : null;
    const elders = !eigen && k && !k.nietVoorWinkel && k.productId && kaart.has(k.productId) ? k.productId : null;
    // Een sterk voorstel op naam: alle woorden van het artikel staan op de lijn, en geen ander artikel past even goed.
    const bruikbaar = r.voorstellen.filter((v) => kaart.has(v.productId));
    const [v1, v2] = bruikbaar;
    const opNaam = v1 && v1.score >= 0.8 && (!v2 || v2.score < v1.score) ? v1.productId : null;
    const sterk = !vorige && !eigen?.nietVoorWinkel ? elders ?? opNaam : null;
    const productId = vorige ?? sterk;
    const btw = r.btwPercentage != null ? m.btwTarieven.find((b) => Number(b.percentage) === Number(r.btwPercentage))?.id : undefined;
    const afdelingId = std.afdelingId;
    // Stuks per verpakking: je eigen keuze van vorige keer gaat voor; staat er op de factuur iets anders, dan eerst kiezen.
    const perVorige = vorige && eigen ? eigen.perVerpakking : null;
    const perFactuur = r.perVerpakking ?? null;
    return {
      key, omschrijving: r.omschrijving,
      voorWinkel: !eigen?.nietVoorWinkel,
      productId, waarom: vorige ? 'vorige' : sterk ? 'voorstel' : null,
      voorstellen: [...(elders && elders !== productId ? [elders] : []), ...bruikbaar.map((v) => v.productId)].filter((id, i, xs) => id !== productId && xs.indexOf(id) === i),
      aantal: metKomma(r.aantal), inkoop: r.eenheidsprijs > 0 ? metKomma(r.eenheidsprijs) : '',
      per: String(perVorige ?? perFactuur ?? 1),
      perKeuze: perVorige != null && perFactuur != null && perVorige !== perFactuur ? { factuur: perFactuur, vorige: perVorige } : null,
      tht: '',
      naam: r.omschrijving, factor: std.factor, verkoop: '',
      btwTariefId: btw ?? std.btwTariefId, afdelingId,
      isAlcohol: alcoholStandaard(m.afdelingen.find((a) => a.id === afdelingId)?.naam, r.omschrijving), alcoholZelf: false,
    };
  }

  async function kiesBestand(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !meta || !producten || bezig) return;
    setFout(''); setFoutRegel(null); setMelding(''); setKlaar(null); setBevestig(null);
    setToonFouten(false); setNieuweLeverancier(null);
    setBezig('inlezen');
    try {
      const res = await factuurInlezen(file);
      // Verse artikellijst: wat sinds het openen van deze pagina bijkwam (vorige factuur, kassa,
      // Beheer, een collega) moet koppelbaar en vindbaar zijn, anders ontstaan er dubbele artikels.
      let ps = producten;
      try { const vers = await getProductenBeheer(''); if (Array.isArray(vers)) ps = vers; } catch { /* vorige lijst */ }
      setProducten(ps);
      const kaart = new Map(ps.map((p) => [p.id, p]));
      if (res.waarschuwing) setMelding(res.waarschuwing);
      setKop({ sleutel: res.sleutel, bestandHash: res.bestandHash, factuurdatum: res.factuurdatum, eerder: res.eerderVerwerkt, bron: res.bron });
      // Alles per factuur opnieuw: een "toch verwerken" of een andere locatie van de vorige factuur geldt niet.
      setToch(false); setPrijsOk(false); setBevestig(null);
      setLeverancierId(res.leverancierId ?? '');
      setLeverancierOpFactuur(res.leverancierId ? '' : res.leverancier?.trim() ?? '');
      setFactuurnummer(res.factuurnummer ?? '');
      setOntvangenOp(vandaag());
      setLocatieId(meta.locaties.find((l) => l.type === 'WINKEL')?.id ?? meta.locaties[0]?.id ?? '');
      const std = standaardVoor(res.leverancierId, meta, ps);
      setRijen(res.regels.map((r, i) => naarRij(r, i, std, meta, kaart)));
      setBulkAfdeling(std.afdelingId); setBulkFactor(std.factor);
      if (!res.regels.length) setFout('Geen regels herkend. Kijk de pdf na, of zet een AI-sleutel (ANTHROPIC_API_KEY) voor betere herkenning.');
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Inlezen mislukt');
    } finally {
      setBezig('');
    }
  }

  // Een lijn aanpassen. Een eerdere vraag om de prijzen te bevestigen geldt dan niet meer.
  function zet(key: number, w: Partial<Rij>) {
    setRijen((rs) => rs.map((r) => (r.key === key ? { ...r, ...w } : r)));
    setPrijsOk(false);
    setBevestig((b) => (b?.code === 'PRIJS_BEVESTIGEN' ? null : b));
    if (foutRegel === key) setFoutRegel(null);
  }
  function zetAfdeling(r: Rij, afdelingId: string) {
    zet(r.key, { afdelingId, ...(r.alcoholZelf ? {} : { isAlcohol: alcoholStandaard(afdelingNaam(afdelingId), r.naam) }) });
  }
  function weglaten(key: number) {
    setRijen((rs) => rs.filter((r) => r.key !== key));
    setBevestig((b) => (b?.code === 'PRIJS_BEVESTIGEN' ? null : b));
  }
  function bulkToepassen() {
    setRijen((rs) => rs.map((r) => {
      if (!r.voorWinkel || r.productId) return r;
      const afdelingId = bulkAfdeling || r.afdelingId;
      return {
        ...r, afdelingId, factor: bulkFactor.trim() ? bulkFactor.trim() : r.factor,
        ...(r.alcoholZelf ? {} : { isAlcohol: alcoholStandaard(afdelingNaam(afdelingId), r.naam) }),
      };
    }));
  }

  // Geen tweede leverancier bij een dubbele klik of Enter + klik (een ref: sneller dan een nieuwe render).
  const leverancierBezig = useRef(false);
  async function bewaarLeverancier() {
    const naam = (nieuweLeverancier ?? '').trim();
    if (!naam || leverancierBezig.current) return;
    leverancierBezig.current = true;
    try {
      const l = await createLeverancier(naam);
      setMeta(await getMeta());
      setLeverancierId(l.id); setNieuweLeverancier(null); setLeverancierOpFactuur('');
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Leverancier toevoegen mislukt');
    } finally {
      leverancierBezig.current = false;
    }
  }

  // Wat er nog ontbreekt op een lijn (dezelfde controles als de server).
  function probleem(r: Rij): string | null {
    if (!r.voorWinkel) return null;
    const a = getal(r.aantal);
    const per = r.per.trim() === '' ? 1 : getal(r.per);
    const ink = r.inkoop.trim() === '' ? 0 : getal(r.inkoop);
    if (!(a > 0)) return 'Geef een aantal.';
    if (r.perKeuze) return `Kies het aantal stuks per verpakking: op de factuur ${r.perKeuze.factuur}, vorige keer ${r.perKeuze.vorige}.`;
    if (!Number.isInteger(per) || per < 1 || per > 1000) return 'Stuks per verpakking: een geheel getal (1 = per stuk).';
    if (!Number.isFinite(ink) || ink < 0) return 'Geef een geldige aankoopprijs.';
    const stuks = Math.round(a * per * 1000) / 1000;
    if (r.productId) {
      const p = perId.get(r.productId);
      return p && p.eenheid !== 'KG' && !Number.isInteger(stuks) ? `${p.naam} tel je per stuk.` : null;
    }
    if (!r.naam.trim()) return 'Geef een naam voor het nieuwe artikel.';
    const zelfdeNaam = perNaam.get(woordenVan(r.naam).join(' '));
    if (zelfdeNaam) return `Er bestaat al een artikel "${zelfdeNaam.naam}". Koppel de lijn aan dat artikel, of geef het nieuwe artikel een andere naam.`;
    if (!r.btwTariefId) return 'Kies een btw-tarief.';
    if (!Number.isInteger(stuks)) return 'Een nieuw artikel tel je per stuk. Maak een weegartikel eerst aan in Beheer en kies het dan.';
    const f = r.factor.trim() === '' ? null : getal(r.factor);
    if (f != null && !(f > 0 && f <= 20)) return 'Geef een geldige factor (bv. 1,85) of laat het vak leeg.';
    if (f != null && !(ink > 0)) return 'Met een factor heb je een aankoopprijs nodig.';
    if (f == null && !(getal(r.verkoop) > 0)) return 'Geef een verkoopprijs of een factor.';
    return null;
  }

  // Aankoopprijs per stuk ver van de huidige: vaak een doosprijs als stukprijs (of omgekeerd).
  function prijsHint(r: Rij): string | null {
    const p = r.productId ? perId.get(r.productId) : undefined;
    const nu = p?.inkoopprijs ? Number(p.inkoopprijs) : 0;
    const per = getal(r.per) || 1;
    const stuk = getal(r.inkoop) / per;
    if (!(nu > 0) || !(stuk > 0)) return null;
    if (stuk > nu * 1.75) return `Veel hoger dan de huidige aankoopprijs (${euro(nu)}). Staat de prijs per doos of tray? Vul dan in hoeveel stuks erin zitten.`;
    if (stuk < nu * 0.5) return `Veel lager dan de huidige aankoopprijs (${euro(nu)}). Klopt het aantal stuks per verpakking?`;
    return null;
  }

  async function verwerk(extra: { toch?: boolean; prijsBevestigd?: boolean } = {}) {
    if (!kop || verwerkBezig.current) return;
    if (rijen.some((r) => probleem(r))) { setToonFouten(true); setFout('Kijk de rood gemarkeerde lijnen na.'); return; }
    verwerkBezig.current = true;
    setBezig('verwerken'); setFout(''); setFoutRegel(null);
    try {
      const regels: VerwerkRegel[] = rijen.map((r) => ({
        omschrijving: r.omschrijving, voorWinkel: r.voorWinkel, productId: r.productId,
        aantal: r.aantal, inkoopprijs: r.inkoop.trim() || '0', perVerpakking: r.per.trim() || '1', tht: r.tht || null,
        ...(r.productId ? {} : {
          naam: r.naam.trim(), factor: r.factor.trim() || null, verkoopprijs: r.factor.trim() ? null : r.verkoop,
          btwTariefId: r.btwTariefId, afdelingId: r.afdelingId || null, isAlcohol: r.isAlcohol,
        }),
      }));
      const res = await factuurVerwerken({
        sleutel: kop.sleutel, bestandHash: kop.bestandHash, leverancierId: leverancierId || null,
        factuurnummer: factuurnummer.trim() || null, factuurdatum: kop.factuurdatum, locatieId, ontvangenOp,
        toch: toch || !!extra.toch, prijsBevestigd: prijsOk || !!extra.prijsBevestigd, regels,
      });
      setKlaar(res); setRijen([]); setKop(null); setBevestig(null); setToonFouten(false); setMelding('');
      window.dispatchEvent(new Event('voorraad-gewijzigd'));
      getProductenBeheer('').then((p) => { if (Array.isArray(p)) setProducten(p); }).catch(() => {});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const f = err as ApiFout;
      if (f.code === 'AL_VERWERKT' || f.code === 'PRIJS_BEVESTIGEN') {
        setBevestig({ code: f.code, tekst: f.message });
      } else {
        setFout(f.message || 'Verwerken mislukt');
        const m = /^Regel (\d+):/.exec(f.message || '');
        if (m) setFoutRegel(rijen[Number(m[1]) - 1]?.key ?? null);
      }
    } finally {
      verwerkBezig.current = false;
      setBezig('');
    }
  }
  function bevestigEnVerwerk() {
    if (bevestig?.code === 'AL_VERWERKT') { setToch(true); void verwerk({ toch: true }); }
    else if (bevestig?.code === 'PRIJS_BEVESTIGEN') { setPrijsOk(true); void verwerk({ prijsBevestigd: true }); }
  }

  if (laadFout) return <div style={{ color: 'crimson' }}>{laadFout}</div>;
  if (!meta || !producten) return <div>Laden…</div>;

  const actief = rijen.filter((r) => r.voorWinkel);
  const telBestaand = actief.filter((r) => r.productId).length;
  const nieuweRijen = actief.filter((r) => !r.productId);
  const telUit = rijen.length - actief.length;
  const telZonderTht = actief.filter((r) => !r.tht && thtNodig(r)).length;
  const telVoorstel = actief.filter((r) => r.waarom === 'voorstel').length;
  const geblokkeerd = !!kop?.eerder && !toch;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h2>Factuur inlezen</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>
        Lees een leveranciersfactuur (pdf) in. Per lijn kies je of het voor de winkel is, en welk artikel het is: een bestaand artikel
        (de voorraad wordt bijgeboekt) of een nieuw artikel. De kassa onthoudt je keuzes per leverancier, zodat de volgende factuur meteen goed staat.
      </p>

      <label style={{ ...btnBlauw, display: 'inline-block', opacity: bezig ? 0.6 : 1 }}>
        {bezig === 'inlezen' ? 'Factuur lezen…' : kop ? 'Andere factuur kiezen' : 'Factuur kiezen (pdf)'}
        <input type="file" accept="application/pdf" onChange={kiesBestand} disabled={!!bezig} style={{ display: 'none' }} />
      </label>
      {kop && <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>Herkenning: {kop.bron === 'ai' ? 'AI' : 'lokaal'}{kop.factuurdatum ? ` · factuurdatum ${datumNl(kop.factuurdatum)}` : ''}</span>}

      {melding && <p style={geel}>{melding}</p>}
      {klaar && <Resultaat klaar={klaar} />}

      {kop && (
        // Tijdens het lezen of verwerken niets aanpassen aan de lijnen (dat zou verloren gaan).
        <fieldset disabled={!!bezig} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div style={{ ...vak, marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={lab}>Leverancier
                <span style={{ display: 'flex', gap: 6 }}>
                  <select value={leverancierId} onChange={(e) => setLeverancierId(e.target.value)} style={{ ...inp, minWidth: 200 }}>
                    <option value="">— onbekend —</option>
                    {meta.leveranciers.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
                  </select>
                  <button type="button" onClick={() => setNieuweLeverancier(leverancierOpFactuur)} style={btnGrijs}>+ Nieuw</button>
                </span>
              </label>
              <label style={lab}>Factuurnummer
                <input value={factuurnummer} onChange={(e) => setFactuurnummer(e.target.value)} maxLength={60} style={{ ...inp, width: 150 }} />
              </label>
              <label style={lab}>Ontvangen op
                <input type="date" value={ontvangenOp} max={vandaag()} onChange={(e) => setOntvangenOp(e.target.value)} style={inp} />
              </label>
              <label style={lab}>Voorraad boeken op
                <select value={locatieId} onChange={(e) => setLocatieId(e.target.value)} style={inp}>
                  {meta.locaties.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
                </select>
              </label>
            </div>
            {nieuweLeverancier !== null && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <input value={nieuweLeverancier} onChange={(e) => setNieuweLeverancier(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void bewaarLeverancier(); }}
                  placeholder="Naam van de leverancier" autoFocus maxLength={120} style={{ ...inp, width: 260 }} />
                <button type="button" onClick={() => void bewaarLeverancier()} style={btnBlauwKlein}>Toevoegen</button>
                <button type="button" onClick={() => setNieuweLeverancier(null)} style={btnGrijs}>Annuleer</button>
              </div>
            )}
            {!leverancierId && leverancierOpFactuur && nieuweLeverancier === null && (
              <div style={{ fontSize: 13, color: '#92400e', marginTop: 6 }}>Op de factuur: "{leverancierOpFactuur}", nog niet gekend. Kies de leverancier of voeg ze toe: dan onthoudt de kassa de keuzes per leverancier.</div>
            )}
          </div>

          {kop.eerder && (
            <div style={oranje}>
              <strong>Deze factuur werd al verwerkt</strong> op {datumNl(kop.eerder.op)}{kop.eerder.door ? ` door ${kop.eerder.door}` : ''} ({kop.eerder.bijgeboekt} bijgeboekt, {kop.eerder.nieuw} nieuw).
              Nog eens verwerken boekt de voorraad dubbel.
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                <input type="checkbox" checked={toch} onChange={(e) => setToch(e.target.checked)} /> Toch nog eens verwerken
              </label>
            </div>
          )}

          {nieuweRijen.length >= 2 && (
            <div style={{ ...vak, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', background: '#f8fafc' }}>
              <span style={{ fontSize: 14, alignSelf: 'center' }}>Voor alle {nieuweRijen.length} nieuwe artikels:</span>
              <label style={lab}>Afdeling
                <select value={bulkAfdeling} onChange={(e) => setBulkAfdeling(e.target.value)} style={inp}>
                  <option value="">— niet wijzigen —</option>
                  {meta.afdelingen.map((a) => <option key={a.id} value={a.id}>{a.naam}</option>)}
                </select>
              </label>
              <label style={lab}>Factor
                <input value={bulkFactor} onChange={(e) => setBulkFactor(e.target.value)} placeholder="bv. 1,85" inputMode="decimal" style={{ ...inp, width: 90 }} />
              </label>
              <button type="button" onClick={bulkToepassen} style={btnGrijs}>Toepassen</button>
            </div>
          )}

          {rijen.map((r, i) => {
            const p = r.productId ? perId.get(r.productId) : undefined;
            const probleemTekst = toonFouten ? probleem(r) : null;
            const rood = !!probleemTekst || foutRegel === r.key;
            const per = getal(r.per) || 1;
            const aantal = getal(r.aantal);
            const stukprijs = Math.round(((getal(r.inkoop) || 0) / per) * 100) / 100;
            const nodig = thtNodig(r);
            const hint = r.voorWinkel ? prijsHint(r) : null;
            const factor = getal(r.factor);
            const factorPrijs = factor > 0 && stukprijs > 0 ? prijsUitFactor(stukprijs, factor) : null;
            const eenheid = p?.eenheid === 'KG' ? 'kg' : 'stuks';
            const pk = r.perKeuze;
            return (
              <div key={`${kop.sleutel}-${r.key}`} style={{ ...kaart, borderColor: rood ? '#dc2626' : '#e5e7eb', background: r.voorWinkel ? '#fff' : '#f9fafb' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: '#9ca3af', fontSize: 12, minWidth: 18 }}>{i + 1}</span>
                  <strong style={{ flex: '1 1 260px', opacity: r.voorWinkel ? 1 : 0.6 }}>{r.omschrijving}</strong>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={r.voorWinkel} onChange={(e) => zet(r.key, { voorWinkel: e.target.checked })} /> Voor de winkel
                  </label>
                  <button type="button" onClick={() => weglaten(r.key)} title="Deze lijn weglaten: niets doen en niets onthouden" aria-label={`Lijn ${i + 1} weglaten`} style={btnX}>×</button>
                </div>

                {!r.voorWinkel ? (
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Niet voor de winkel: komt niet in de kassa en niet in de voorraad. Dat wordt onthouden voor de volgende factuur.</div>
                ) : (
                  <>
                    <div style={rij}>
                      {p ? (
                        <>
                          <span style={chip}>{p.naam}</span>
                          {r.waarom === 'vorige' && <span style={{ ...badge, background: '#dcfce7', color: '#166534' }}>zoals vorige keer</span>}
                          {r.waarom === 'voorstel' && <span style={{ ...badge, background: '#fef3c7', color: '#92400e' }}>voorstel: kijk na</span>}
                          <span style={{ fontSize: 12, color: '#6b7280' }}>
                            nu {euro(Number(p.verkoopprijs))}{p.inkoopprijs ? ` · aankoop ${euro(Number(p.inkoopprijs))}` : ''}{p.factor ? ` · factor ${metKomma(Number(p.factor))}` : ''}
                          </span>
                          <button type="button" onClick={() => zet(r.key, { productId: null, waarom: null, voorstellen: [p.id, ...r.voorstellen.filter((id) => id !== p.id)] })} style={btnLink}>
                            Ander artikel of nieuw
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ ...badge, background: '#dbeafe', color: '#1e40af' }}>Nieuw artikel</span>
                          <span style={{ fontSize: 13, color: '#6b7280' }}>of koppel aan een bestaand artikel:</span>
                          <ArtikelZoeker index={index} producten={producten} onKies={(id) => zet(r.key, { productId: id, waarom: null })} />
                        </>
                      )}
                    </div>
                    {!p && r.voorstellen.length > 0 && (
                      <div style={rij}>
                        <span style={{ fontSize: 13, color: '#6b7280' }}>Bedoel je:</span>
                        {r.voorstellen.slice(0, 3).map((id) => {
                          const v = perId.get(id);
                          return v ? <button key={id} type="button" onClick={() => zet(r.key, { productId: id, waarom: null })} style={btnVoorstel}>{v.naam}</button> : null;
                        })}
                      </div>
                    )}

                    <div style={rij}>
                      <label style={lab}>Aantal
                        <input value={r.aantal} onChange={(e) => zet(r.key, { aantal: e.target.value })} inputMode="decimal" style={{ ...inp, width: 80 }} />
                      </label>
                      <label style={lab}>Aankoopprijs (excl. btw)
                        <input value={r.inkoop} onChange={(e) => zet(r.key, { inkoop: e.target.value })} inputMode="decimal" style={{ ...inp, width: 110 }} />
                      </label>
                      <label style={lab} title="Rekent de factuur per tray of doos? Vul in hoeveel stuks erin zitten. Wordt onthouden.">Stuks per verpakking
                        <input value={r.per} onChange={(e) => zet(r.key, { per: e.target.value, perKeuze: null })} inputMode="numeric" style={{ ...inp, width: 80 }} />
                      </label>
                      <label style={lab}>{nodig ? 'THT *' : 'THT (niet nodig)'}
                        <input type="date" value={r.tht} min={ontvangenOp} onChange={(e) => zet(r.key, { tht: e.target.value })} style={inp} />
                      </label>
                      {per > 1 && aantal > 0 && (
                        <span style={{ fontSize: 13, color: '#374151', alignSelf: 'center' }}>= {metKomma(aantal * per)} {eenheid} à {euro(stukprijs)}</span>
                      )}
                    </div>
                    {pk && (
                      <div style={{ ...geel, margin: '6px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>Op de factuur staat {pk.factuur} per verpakking, vorige keer koos je {pk.vorige}. Wat klopt?</span>
                        <button type="button" onClick={() => zet(r.key, { per: String(pk.vorige), perKeuze: null })} style={btnGrijs}>{pk.vorige}, zoals vorige keer</button>
                        <button type="button" onClick={() => zet(r.key, { per: String(pk.factuur), perKeuze: null })} style={btnGrijs}>{pk.factuur}, zoals op de factuur</button>
                      </div>
                    )}
                    {hint && !pk && <div style={{ ...geel, margin: '6px 0 0' }}>{hint}</div>}

                    {!p && (
                      <div style={{ ...rij, background: '#f8fafc', borderRadius: 8, padding: 8 }}>
                        <label style={{ ...lab, flex: '2 1 220px' }}>Naam in de kassa
                          <input value={r.naam} onChange={(e) => zet(r.key, { naam: e.target.value })} maxLength={200} style={{ ...inp, width: '100%' }} />
                        </label>
                        <label style={lab}>Afdeling
                          <select value={r.afdelingId} onChange={(e) => zetAfdeling(r, e.target.value)} style={inp}>
                            <option value="">— geen —</option>
                            {meta.afdelingen.map((a) => <option key={a.id} value={a.id}>{a.naam}</option>)}
                          </select>
                        </label>
                        <label style={lab}>Btw
                          <select value={r.btwTariefId} onChange={(e) => zet(r.key, { btwTariefId: e.target.value })} style={inp}>
                            {meta.btwTarieven.map((b) => <option key={b.id} value={b.id}>{Number(b.percentage)}%</option>)}
                          </select>
                        </label>
                        <label style={lab}>Factor
                          <input value={r.factor} onChange={(e) => zet(r.key, { factor: e.target.value })} placeholder="bv. 1,85" inputMode="decimal" style={{ ...inp, width: 80 }} />
                        </label>
                        {r.factor.trim() ? (
                          <div style={lab}>Verkoopprijs<div style={{ padding: '7px 0', fontSize: 15, fontWeight: 600, color: '#111827' }}>{factorPrijs != null ? euro(factorPrijs) : '—'}</div></div>
                        ) : (
                          <label style={lab}>Verkoopprijs (incl. btw)
                            <input value={r.verkoop} onChange={(e) => zet(r.key, { verkoop: e.target.value })} inputMode="decimal" style={{ ...inp, width: 100 }} />
                          </label>
                        )}
                        <label style={{ ...lab, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', color: '#374151', fontSize: 13 }}>
                          <input type="checkbox" checked={r.isAlcohol} onChange={(e) => zet(r.key, { isAlcohol: e.target.checked, alcoholZelf: true })} /> Alcohol (leeftijd controleren)
                        </label>
                      </div>
                    )}
                    {probleemTekst && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 6 }}>{probleemTekst}</div>}
                  </>
                )}
              </div>
            );
          })}

          {rijen.length > 0 && (
            <div style={{ ...vak, position: 'sticky', bottom: 0, background: '#fff', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
              {nieuweRijen.length > 0 && <div style={uitleg}>Er komen <strong>{nieuweRijen.length} nieuwe artikels</strong> in de kassa. Bestaat een artikel al? Koppel het dan, anders staat het er twee keer in.</div>}
              {telVoorstel > 0 && <div style={uitleg}>{telVoorstel} {telVoorstel === 1 ? 'lijn staat' : 'lijnen staan'} op een voorstel (oranje): kijk na of het juiste artikel gekozen is.</div>}
              {telZonderTht > 0 && <div style={uitleg}>{telZonderTht} {telZonderTht === 1 ? 'lijn' : 'lijnen'} zonder THT terwijl het artikel er een nodig heeft. Dat mag: je kan de THT later invullen bij Voorraad.</div>}
              {bevestig && (
                <div style={{ ...oranje, margin: '8px 0' }}>
                  <div>{bevestig.tekst}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={bevestigEnVerwerk} disabled={!!bezig} style={btnOranje}>{bevestig.code === 'AL_VERWERKT' ? 'Toch verwerken' : 'De prijzen kloppen, verwerken'}</button>
                    <button type="button" onClick={() => setBevestig(null)} style={btnGrijs}>Terug naar de lijnen</button>
                  </div>
                </div>
              )}
              {fout && <p style={{ color: 'crimson', margin: '6px 0' }}>{fout}</p>}
              <button type="button" onClick={() => void verwerk()} disabled={!!bezig || geblokkeerd || !locatieId} style={{ ...btnGroen, width: '100%', marginTop: 6, opacity: bezig || geblokkeerd ? 0.6 : 1 }}>
                {bezig === 'verwerken' ? 'Bezig…'
                  : geblokkeerd ? 'Al verwerkt: vink "toch nog eens verwerken" aan'
                  : `Verwerken: ${telBestaand} bijboeken · ${nieuweRijen.length} nieuw${telUit ? ` · ${telUit} niet voor de winkel` : ''}`}
              </button>
            </div>
          )}
        </fieldset>
      )}
      {(!kop || rijen.length === 0) && fout && <p style={{ color: 'crimson' }}>{fout}</p>}
    </div>
  );
}

// Zoeken in de artikels op naam (zoals aan de kassa) of op barcode.
function ArtikelZoeker({ index, producten, onKies }: { index: ZoekIndex<ProductVol>; producten: ProductVol[]; onKies: (id: string) => void }) {
  const [tekst, setTekst] = useState('');
  const [open, setOpen] = useState(false);
  const res = useMemo(() => zoekOpNaam(index, tekst), [index, tekst]);
  function kies(id: string) { onKies(id); setTekst(''); setOpen(false); }
  function enter() {
    const t = tekst.trim();
    const viaCode = t ? producten.find((p) => !p.vrijePrijs && !p.isStatiegeld && (p.barcode === t || p.interneCode === t)) : undefined;
    if (viaCode) kies(viaCode.id);
    else if (res.enige) kies(res.enige.id);
  }
  return (
    <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
      <input value={tekst} placeholder="Zoek op naam of barcode"
        onChange={(e) => { setTekst(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enter(); } else if (e.key === 'Escape') setOpen(false); }}
        style={{ ...inp, width: '100%' }} />
      {open && zoektOpNaam(tekst) && (
        <div style={keuzelijst}>
          {res.treffers.length === 0 && <div style={{ padding: 8, fontSize: 13, color: '#6b7280' }}>Niets gevonden</div>}
          {res.treffers.map((p) => (
            <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); kies(p.id); }} style={treffer}>
              <span>{p.naam}</span><span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{euro(Number(p.verkoopprijs))}</span>
            </button>
          ))}
          {res.meer > 0 && <div style={{ padding: '4px 8px', fontSize: 12, color: '#6b7280' }}>… en nog {res.meer}: typ verder</div>}
        </div>
      )}
    </div>
  );
}

function Resultaat({ klaar }: { klaar: VerwerkResultaat }) {
  return (
    <div style={{ ...vak, marginTop: 14, borderColor: '#86efac', background: '#f0fdf4' }}>
      <strong style={{ color: '#166534' }}>✓ {klaar.alVerwerkt ? 'Deze factuur was al verwerkt: er is niets dubbel geboekt.' : 'Factuur verwerkt.'}</strong>
      <div style={{ marginTop: 4 }}>{klaar.bijgeboekt} bijgeboekt op bestaande artikels · {klaar.nieuw} nieuwe artikels · {klaar.overgeslagen} niet voor de winkel.</div>
      {klaar.zonderTht > 0 && (
        <div style={{ marginTop: 4 }}>{klaar.zonderTht} {klaar.zonderTht === 1 ? 'lijn' : 'lijnen'} zonder THT voor artikels die er een nodig hebben: vul de THT in bij <Link to="/kassa/voorraad">Voorraad</Link>.</div>
      )}
      {klaar.prijswijzigingen.length > 0 && (
        <div style={{ marginTop: 8, overflowX: 'auto' }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Nieuwe prijzen (de aankoopprijs zakt nooit vanzelf; met een factor stijgt de verkoopprijs mee):</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#6b7280' }}><th style={cel}>Artikel</th><th style={cel}>Aankoop</th><th style={cel}>Verkoop</th></tr></thead>
            <tbody>
              {klaar.prijswijzigingen.map((w, i) => (
                <tr key={i}>
                  <td style={cel}>{w.naam}</td>
                  <td style={cel}>{w.oudeInkoop != null ? euro(w.oudeInkoop) : '—'} → {euro(w.inkoopprijs)}</td>
                  <td style={cel}>{euro(w.oudeVerkoop)} → <strong>{euro(w.verkoopprijs)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#6b7280' };
const inp: CSSProperties = { padding: 7, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box', background: '#fff' };
const vak: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 10 };
const kaart: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginTop: 10 };
const rij: CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 };
const chip: CSSProperties = { padding: '5px 10px', borderRadius: 999, background: '#f1f5f9', fontWeight: 600, fontSize: 14 };
const badge: CSSProperties = { padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 };
const geel: CSSProperties = { color: '#92400e', background: '#fef3c7', padding: '8px 12px', borderRadius: 8, fontSize: 13 };
const oranje: CSSProperties = { color: '#7c2d12', background: '#ffedd5', border: '1px solid #fdba74', padding: '10px 12px', borderRadius: 8, marginTop: 10, fontSize: 14 };
const uitleg: CSSProperties = { fontSize: 13, color: '#374151', marginBottom: 4 };
const keuzelijst: CSSProperties = { position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 6px 16px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' };
const treffer: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', padding: '7px 9px', border: 'none', borderBottom: '1px solid #f1f5f9', background: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 14 };
const cel: CSSProperties = { padding: '3px 10px 3px 0' };
const btnBlauw: CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 8, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnBlauwKlein: CSSProperties = { padding: '7px 12px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnGroen: CSSProperties = { padding: 12, border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const btnOranje: CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 6, background: '#ea580c', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnGrijs: CSSProperties = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const btnLink: CSSProperties = { border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', fontSize: 13, padding: 0 };
const btnVoorstel: CSSProperties = { padding: '4px 10px', border: '1px solid #93c5fd', borderRadius: 999, background: '#eff6ff', color: '#1e40af', cursor: 'pointer', fontSize: 13 };
const btnX: CSSProperties = { border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' };
