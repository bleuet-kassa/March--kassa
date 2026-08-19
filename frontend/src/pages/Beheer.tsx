import { useEffect, useState, type CSSProperties } from 'react';
import {
  getMeta, getProductenBeheer, getProduct, getProductByBarcode, nieuweBarcode,
  createProduct, updateProduct, createCategorie, createAfdeling, createLeverancier, voorraadOntvangst,
  uploadSiteAfbeelding,
  type Meta, type ProductVol, type ProductInput,
} from '../api/client';

// Beheerscherm (Fase 1): producten manueel of via barcode toevoegen/bewerken en
// voorraad ontvangen. (Factuur-import volgt als aparte stap.)
export function Beheer() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [lijst, setLijst] = useState<ProductVol[]>([]);
  const [zoek, setZoek] = useState('');
  const [barcode, setBarcode] = useState('');
  const [fout, setFout] = useState('');
  const [bewerken, setBewerken] = useState<{ mode: 'nieuw' | 'edit'; product: ProductVol | null; prefillBarcode?: string } | null>(null);

  async function laadMeta() { setMeta(await getMeta()); }
  async function laadLijst() { setLijst(await getProductenBeheer(zoek)); }

  useEffect(() => { laadMeta(); }, []);
  useEffect(() => { const t = setTimeout(laadLijst, 200); return () => clearTimeout(t); }, [zoek]);

  // Barcode toevoegen: bestaat ze -> bewerken; onbekend -> nieuw met code ingevuld.
  async function barcodeToevoegen() {
    const code = barcode.trim();
    if (!code) return;
    setFout('');
    try {
      const gevonden = await getProductByBarcode(code);
      const vol = await getProduct(gevonden.id);
      setBewerken({ mode: 'edit', product: vol });
    } catch {
      setBewerken({ mode: 'nieuw', product: null, prefillBarcode: code });
    }
    setBarcode('');
  }

  if (bewerken && meta) {
    return (
      <ProductForm
        meta={meta}
        product={bewerken.product}
        prefillBarcode={bewerken.prefillBarcode}
        onMetaWijzig={laadMeta}
        onKlaar={() => { setBewerken(null); laadLijst(); }}
      />
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h2>Beheer — producten</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={muted}>Zoeken (naam of barcode)</div>
          <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek…" style={inp} />
        </div>
        <div style={{ flex: '1 1 260px' }}>
          <div style={muted}>Barcode toevoegen / opzoeken</div>
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') barcodeToevoegen(); }}
            placeholder="Scan of typ een barcode en druk Enter"
            style={inp}
          />
        </div>
        <button onClick={() => setBewerken({ mode: 'nieuw', product: null })} style={btnBlauw}>+ Nieuw product</button>
      </div>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: '6px 4px' }}>Naam</th>
            <th style={{ padding: '6px 4px' }}>Barcode</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Verkoop</th>
            <th style={{ padding: '6px 4px' }}>BTW</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Voorraad</th>
          </tr>
        </thead>
        <tbody>
          {lijst.map((p) => {
            const totaalStock = p.voorraad.reduce((s, v) => s + Number(v.aantal), 0);
            return (
              <tr key={p.id} onClick={() => setBewerken({ mode: 'edit', product: p })}
                style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}>
                <td style={{ padding: '8px 4px' }}>{p.naam}{p.isAlcohol && ' 🍷'}</td>
                <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 13 }}>{p.barcode}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>€ {Number(p.verkoopprijs).toFixed(2)}</td>
                <td style={{ padding: '8px 4px' }}>{p.btwTarief.percentage}%</td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>{totaalStock}</td>
              </tr>
            );
          })}
          {lijst.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: '#999' }}>Geen producten gevonden.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ProductForm({
  meta, product, prefillBarcode, prefillAfdelingId, onKlaar, onMetaWijzig,
}: {
  meta: Meta;
  product: ProductVol | null;
  prefillBarcode?: string;
  prefillAfdelingId?: string;
  onKlaar: () => void;
  onMetaWijzig: () => Promise<void>;
}) {
  const [naam, setNaam] = useState(product?.naam ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? prefillBarcode ?? '');
  const [verkoop, setVerkoop] = useState(product ? String(Number(product.verkoopprijs)) : '');
  const [inkoop, setInkoop] = useState(product?.inkoopprijs != null ? String(Number(product.inkoopprijs)) : '');
  const [btwId, setBtwId] = useState(product?.btwTariefId ?? meta.btwTarieven[0]?.id ?? '');
  const [afdId, setAfdId] = useState(
    product?.afdelingId
      ?? (product?.categorieId ? (meta.categorieen.find((c) => c.id === product.categorieId)?.afdelingId ?? '') : '')
      ?? prefillAfdelingId
      ?? '',
  );
  const [catId, setCatId] = useState(product?.categorieId ?? '');
  const [levId, setLevId] = useState(product?.leverancierId ?? '');
  const [alcohol, setAlcohol] = useState(product?.isAlcohol ?? false);
  const [webshop, setWebshop] = useState(product?.webshopZichtbaar ?? false);
  const [foto, setFoto] = useState(product?.fotoUrl ?? '');
  const [eenheid, setEenheid] = useState(product?.eenheid ?? 'STUK');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  const num = (s: string) => Number(s.replace(',', '.'));

  async function opslaan() {
    setFout('');
    if (!naam.trim()) { setFout('Naam is verplicht.'); return; }
    if (!verkoop || Number.isNaN(num(verkoop))) { setFout('Geef een geldige verkoopprijs.'); return; }
    if (!afdId) { setFout('Kies een afdeling.'); return; }
    setBezig(true);
    const input: ProductInput = {
      naam: naam.trim(),
      barcode: barcode.trim() || null,
      verkoopprijs: num(verkoop),
      inkoopprijs: inkoop ? num(inkoop) : null,
      isAlcohol: alcohol,
      eenheid,
      webshopZichtbaar: webshop,
      fotoUrl: foto || null,
      btwTariefId: btwId,
      afdelingId: afdId || null,
      categorieId: catId || null,
      leverancierId: levId || null,
    };
    try {
      if (product) await updateProduct(product.id, input);
      else await createProduct(input);
      onKlaar();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Opslaan mislukt');
    } finally {
      setBezig(false);
    }
  }

  async function genereer() {
    setBarcode(await nieuweBarcode());
  }
  async function uploadFoto(bestand: File | undefined) {
    if (!bestand) return;
    try { const { url } = await uploadSiteAfbeelding(bestand); setFoto(url); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Uploaden mislukt'); }
  }
  async function nieuweAfdeling() {
    const naam = window.prompt('Naam nieuwe afdeling? (bv. Traiteur, Voeding, Dranken)');
    if (!naam?.trim()) return;
    const a = await createAfdeling(naam.trim());
    await onMetaWijzig();
    setAfdId(a.id);
  }
  async function nieuweCategorie() {
    if (!afdId) { setFout('Kies eerst een afdeling voor de nieuwe categorie.'); return; }
    const naam = window.prompt('Naam nieuwe categorie (binnen deze afdeling)?');
    if (!naam?.trim()) return;
    const c = await createCategorie(naam.trim(), afdId || null);
    await onMetaWijzig();
    setAfdId(c.afdelingId ?? afdId);
    setCatId(c.id);
  }
  async function nieuweLeverancier() {
    const naam = window.prompt('Naam nieuwe leverancier?');
    if (!naam?.trim()) return;
    const l = await createLeverancier(naam.trim());
    await onMetaWijzig();
    setLevId(l.id);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <button onClick={onKlaar} style={{ ...btnGrijs, marginBottom: 12 }}>← Terug naar lijst</button>
      <h2>{product ? 'Product bewerken' : 'Nieuw product'}</h2>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <label style={muted}>Naam *</label>
      <input value={naam} onChange={(e) => setNaam(e.target.value)} style={inp} autoFocus />

      <label style={muted}>Barcode</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="EAN of laat leeg voor automatisch" style={{ ...inp, flex: 1 }} />
        <button onClick={genereer} style={btnGrijs} title="Genereer een eigen in-store barcode">Genereer</button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={muted}>Verkoopprijs (incl. BTW) *</label>
          <input value={verkoop} onChange={(e) => setVerkoop(e.target.value)} inputMode="decimal" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={muted}>Inkoopprijs</label>
          <input value={inkoop} onChange={(e) => setInkoop(e.target.value)} inputMode="decimal" style={inp} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={muted}>BTW-tarief *</label>
          <select value={btwId} onChange={(e) => setBtwId(e.target.value)} style={inp}>
            {meta.btwTarieven.map((b) => <option key={b.id} value={b.id}>{b.naam}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={muted}>Eenheid</label>
          <select value={eenheid} onChange={(e) => setEenheid(e.target.value)} style={inp}>
            <option value="STUK">Stuk</option>
            <option value="KG">Kg</option>
          </select>
        </div>
      </div>

      <label style={muted}>Afdeling (winkelsectie — verplicht)</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <select
          value={afdId}
          onChange={(e) => {
            setAfdId(e.target.value);
            const c = meta.categorieen.find((x) => x.id === catId);
            if (c && c.afdelingId !== e.target.value) setCatId('');
          }}
          style={{ ...inp, flex: 1, marginBottom: 0 }}
        >
          <option value="">—</option>
          {meta.afdelingen.map((a) => <option key={a.id} value={a.id}>{a.naam}</option>)}
        </select>
        <button onClick={nieuweAfdeling} style={btnGrijs}>+</button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={muted}>Categorie (optioneel)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={catId} onChange={(e) => setCatId(e.target.value)} style={{ ...inp, flex: 1 }} disabled={!afdId}>
              <option value="">—</option>
              {meta.categorieen.filter((c) => !afdId || c.afdelingId === afdId).map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
            </select>
            <button onClick={nieuweCategorie} style={btnGrijs}>+</button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={muted}>Leverancier</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={levId} onChange={(e) => setLevId(e.target.value)} style={{ ...inp, flex: 1 }}>
              <option value="">—</option>
              {meta.leveranciers.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
            </select>
            <button onClick={nieuweLeverancier} style={btnGrijs}>+</button>
          </div>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px' }}>
        <input type="checkbox" checked={alcohol} onChange={(e) => setAlcohol(e.target.checked)} />
        Alcohol (leeftijdscontrole aan de kassa)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>
        <input type="checkbox" checked={webshop} onChange={(e) => setWebshop(e.target.checked)} />
        Toon in de webshop (enkel zichtbaar zolang het product actief is)
      </label>
      <div style={{ margin: '0 0 12px' }}>
        <div style={muted}>Productfoto (webshop)</div>
        {foto
          ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <img src={foto} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <label style={{ ...btnGrijs, cursor: 'pointer' }}>Vervangen<input type="file" accept="image/*" hidden onChange={(e) => uploadFoto(e.target.files?.[0])} /></label>
              <button onClick={() => setFoto('')} style={{ ...btnGrijs, color: 'crimson' }}>×</button>
            </div>
          : <label style={{ ...btnGrijs, cursor: 'pointer', display: 'inline-block' }}>Foto kiezen<input type="file" accept="image/*" hidden onChange={(e) => uploadFoto(e.target.files?.[0])} /></label>}
      </div>

      <button onClick={opslaan} disabled={bezig} style={{ ...btnGroen, width: '100%' }}>
        {bezig ? 'Bezig…' : product ? 'Wijzigingen opslaan' : 'Product aanmaken'}
      </button>

      {product && <Ontvangst product={product} meta={meta} />}
    </div>
  );
}

// Voorraad bijboeken op een locatie (bv. bij een levering).
function Ontvangst({ product, meta }: { product: ProductVol; meta: Meta }) {
  const [locatieId, setLocatieId] = useState(meta.locaties[0]?.id ?? '');
  const [aantal, setAantal] = useState('');
  const [melding, setMelding] = useState('');

  async function boek() {
    const n = Number(aantal.replace(',', '.'));
    if (!n) return;
    await voorraadOntvangst(product.id, locatieId, n);
    setMelding(`+${n} geboekt.`);
    setAantal('');
  }

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
      <h3 style={{ margin: '0 0 8px' }}>Voorraad ontvangen</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={locatieId} onChange={(e) => setLocatieId(e.target.value)} style={{ ...inp, width: 'auto' }}>
          {meta.locaties.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
        </select>
        <input value={aantal} onChange={(e) => setAantal(e.target.value)} inputMode="decimal" placeholder="Aantal" style={{ ...inp, width: 120 }} />
        <button onClick={boek} style={btnBlauw}>Boek ontvangst</button>
        {melding && <span style={{ color: '#16a34a' }}>{melding}</span>}
      </div>
      <div style={{ ...muted, marginTop: 8 }}>
        Huidige voorraad: {product.voorraad.map((v) => `${v.locatie?.naam ?? v.locatieId}: ${Number(v.aantal)}`).join(' · ') || '—'}
      </div>
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 9, fontSize: 15, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 14px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnGroen: CSSProperties = { padding: 12, border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 16 };
const btnGrijs: CSSProperties = { padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
