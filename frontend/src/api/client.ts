// Kleine helper om de centrale server aan te spreken.
const BASE = '/api';

export type BtwTarief = { id: string; naam: string; percentage: string };
export type Product = {
  id: string;
  naam: string;
  barcode: string | null;
  verkoopprijs: string; // incl. BTW (consumentenprijs)
  isAlcohol: boolean;
  btwTarief: BtwTarief;
};

export type Betaalwijze = 'CASH' | 'BANCONTACT' | 'KAART' | 'OVERSCHRIJVING' | 'QR' | 'EIGEN_REKENING';

export type AfrekenLijn = { productId: string; aantal: number; kortingPct?: number; bedrag?: number };

// "Diversen"/vrij-bedrag-knoppen voor de kassa (Diversen 6%/12%, Cadeaubon).
export type SpeciaalProduct = { id: string; naam: string; interneCode: string | null; btwTarief: BtwTarief; vrijePrijs: boolean };
export async function getSpeciaalProducten(): Promise<SpeciaalProduct[]> {
  return (await fetch(`${BASE}/producten/speciaal`)).json();
}

export type Gebruiker = { id: string; naam: string; rol: string };

export type Ticket = {
  id: string;
  datum: string;
  betaalwijze: Betaalwijze;
  verkoper: string | null;
  offline?: boolean; // true = lokaal bewaard, nog te synchroniseren
  kortingReden?: string | null; // verkoopbrede korting (bv. "Korting 10%")
  verkoopKortingPct?: number | null; // verkoopbrede korting (%)
  subtotaal?: number; // som van de lijnen vóór de verkoopbrede korting
  totaal: number;
  ontvangen: number | null;
  teruggeven: number | null;
  lijnen: {
    naam: string;
    aantal: number;
    eenheidsprijs: number;
    btwPercentage: number;
    totaal: number;
    kortingPct?: number | null; // lijnkorting (%)
    origineelTotaal?: number | null; // lijntotaal vóór de lijnkorting
  }[];
  btwOverzicht: { percentage: number; maatstaf: number; btw: number }[];
};

export async function getProductByBarcode(barcode: string): Promise<Product> {
  const res = await fetch(`${BASE}/producten/barcode/${encodeURIComponent(barcode)}`);
  if (!res.ok) throw new Error('Product niet gevonden');
  return res.json();
}

export async function getProducten(): Promise<Product[]> {
  const res = await fetch(`${BASE}/producten`);
  return res.json();
}

export async function afrekenen(input: {
  lijnen: AfrekenLijn[];
  betaalwijze?: Betaalwijze; // weglaten bij "op rekening"
  ontvangen?: number;
  gebruikerId?: string;
  kortingReden?: string;
  verkoopKortingPct?: number;
  rekeningBedrijfId?: string; // "op rekening": geboekt op bedrijf + lid
  rekeningLidId?: string;
  idempotencyKey?: string;
}): Promise<Ticket> {
  const res = await fetch(`${BASE}/verkopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? 'Afrekenen mislukt');
  }
  return res.json();
}

// --- Verkopen terugvinden / ticket herafdrukken ---
export type VerkoopKort = {
  id: string; datum: string; totaal: number;
  betaalwijze: Betaalwijze | null; kanaal: string; leverwijze: string | null;
  verkoper: string | null; aantalLijnen: number;
  afgesloten?: boolean; geannuleerd?: boolean;
};
export async function getVerkopen(datum?: string): Promise<VerkoopKort[]> {
  const q = datum ? `?datum=${encodeURIComponent(datum)}` : '';
  return (await fetch(`${BASE}/verkopen${q}`)).json();
}
export async function getTicket(id: string): Promise<Ticket> {
  return (await fetch(`${BASE}/verkopen/${id}/ticket`)).json();
}
// Een verkoop annuleren/schrappen (admin): telt niet meer mee in de dagafsluiting,
// de voorraad wordt teruggeboekt.
export async function annuleerVerkoop(id: string, reden?: string): Promise<Ticket> {
  return jsonOrThrow(await fetch(`${BASE}/verkopen/${id}/annuleer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reden }),
  }));
}
// De betaalwijze van een bestaande verkoop wijzigen (admin).
export async function wijzigVerkoopBetaalwijze(id: string, betaalwijze: Betaalwijze): Promise<Ticket> {
  return jsonOrThrow(await fetch(`${BASE}/verkopen/${id}/betaalwijze`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ betaalwijze }),
  }));
}

// --- Auth (verkoper) ---
export type Personeelslid = { id: string; naam: string; email: string; rol: string; actief: boolean };

// Actieve verkopers (voor de verkoper-keuze per ticket aan de kassa).
export async function getGebruikers(): Promise<Gebruiker[]> {
  return (await fetch(`${BASE}/auth/gebruikers`)).json();
}
// Volledig personeelsbeheer (incl. niet-actieve accounts).
export async function getPersoneel(): Promise<Personeelslid[]> {
  return (await fetch(`${BASE}/auth/personeel`)).json();
}
export async function nieuwPersoneelslid(input: { naam: string; email: string; wachtwoord: string; rol?: string }): Promise<Personeelslid> {
  return jsonOrThrow(
    await fetch(`${BASE}/auth/personeel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),
  );
}
export async function updatePersoneelslid(id: string, input: { naam?: string; rol?: string; actief?: boolean; wachtwoord?: string }): Promise<Personeelslid> {
  return jsonOrThrow(
    await fetch(`${BASE}/auth/personeel/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),
  );
}

export async function login(email: string, wachtwoord: string): Promise<Gebruiker & { token: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, wachtwoord }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? 'Inloggen mislukt');
  }
  return res.json();
}

// --- Dagontvangsten (wettelijk dagrapport) ---
export type BtwRij = { percentage: number; maatstaf: number; btw: number };
export type Dagrapport = {
  id?: string;
  volgnummer: number | null;
  onderneming: { naam: string; ondernemingsnummer: string; btwNummer: string | null; adres: string | null } | null;
  locatie: string;
  verkoper: string | null;
  vanaf: string | null;
  tot: string | null;
  dagontvangsten: {
    aantal: number;
    perBetaalwijze: Record<string, number>;
    perBtwTarief: BtwRij[];
    perCategorie: { categorie: string; omzetIncl: number }[];
    totaalExcl: number;
    totaalBtw: number;
    totaalIncl: number;
  };
  eigenGebruik?: { aantal: number; incl: number };
  facturen: { ref: string; datum: string; klant: string; btwNummer: string | null; excl: number; btw: number; incl: number }[];
  facturenTotaal: { aantal: number; excl: number; btw: number; incl: number };
  algemeenTotaalIncl: number;
};
export type AfsluitingKort = { id: string; volgnummer: number | null; tot: string; totaal: string; aantalVerkopen: number };

export async function getDagoverzicht(): Promise<Dagrapport> {
  return (await fetch(`${BASE}/dagafsluiting/overzicht`)).json();
}
export async function dagAfsluiten(gebruikerId?: string): Promise<Dagrapport> {
  return jsonOrThrow(
    await fetch(`${BASE}/dagafsluiting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gebruikerId }),
    }),
  );
}
export async function getAfsluitingen(): Promise<AfsluitingKort[]> {
  return (await fetch(`${BASE}/dagafsluiting`)).json();
}
export async function getDagRapport(id: string): Promise<Dagrapport> {
  return (await fetch(`${BASE}/dagafsluiting/${id}`)).json();
}
export function dagafsluitingCsvUrl(id: string): string {
  return `${BASE}/dagafsluiting/${id}/csv`;
}
export async function updateOnderneming(input: { naam?: string; btwNummer?: string; adres?: string }) {
  return jsonOrThrow(
    await fetch(`${BASE}/meta/onderneming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}
export async function getOndernemingen(): Promise<Onderneming[]> {
  return (await fetch(`${BASE}/meta/ondernemingen`)).json();
}
export async function updateOndernemingById(
  id: string,
  input: { naam?: string; ondernemingsnummer?: string; btwNummer?: string; adres?: string },
): Promise<Onderneming> {
  return jsonOrThrow(
    await fetch(`${BASE}/meta/onderneming/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

// --- Managementrapporten (admin) ---
export type MaandRij = { jaar: number; maand: number; aantal: number; omzetIncl: number };
export type CategorieRij = { categorie: string; omzetExcl: number; inkoop: number; marge: number; margePct: number; aandeelPct: number };
export type CategorieRapport = { totaal: { omzetExcl: number; inkoop: number; marge: number; margePct: number }; categorieen: CategorieRij[] };

export async function getMaandoverzicht(): Promise<MaandRij[]> {
  return (await fetch(`${BASE}/rapporten/maandoverzicht`)).json();
}
export async function getCategorieRapport(van?: string, tot?: string): Promise<CategorieRapport> {
  const q = new URLSearchParams();
  if (van) q.set('van', van);
  if (tot) q.set('tot', tot);
  return (await fetch(`${BASE}/rapporten/categorie?${q.toString()}`)).json();
}

export type KassaVsFacturen = {
  kasticket: { aantal: number; omzetIncl: number };
  facturen: { aantal: number; omzetIncl: number };
};
export async function getKassaVsFacturen(van?: string, tot?: string): Promise<KassaVsFacturen> {
  const q = new URLSearchParams();
  if (van) q.set('van', van);
  if (tot) q.set('tot', tot);
  return (await fetch(`${BASE}/rapporten/kassa-facturen?${q.toString()}`)).json();
}

// --- Cadeaubonnen ---
export type Cadeaubon = {
  id: string; nummer: string; bedrag: string; datumUitgifte: string;
  ingewisseld: boolean; ingewisseldOp: string | null;
  gebruiker: { naam: string } | null;
};
export async function getCadeaubonnen(zoek = ''): Promise<Cadeaubon[]> {
  return (await fetch(`${BASE}/cadeaubonnen?zoek=${encodeURIComponent(zoek)}`)).json();
}
export async function getNieuwBonNummer(): Promise<string> {
  return (await (await fetch(`${BASE}/cadeaubonnen/nieuw-nummer`)).json()).nummer;
}
export async function createCadeaubon(input: { nummer?: string; bedrag: number; datumUitgifte?: string; gebruikerId?: string }): Promise<Cadeaubon> {
  return jsonOrThrow(
    await fetch(`${BASE}/cadeaubonnen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}
export async function bonInwisselen(id: string): Promise<Cadeaubon> {
  return jsonOrThrow(await fetch(`${BASE}/cadeaubonnen/${id}/inwisselen`, { method: 'POST' }));
}

// --- Beheer: producten, meta, voorraad ---
export type Afdeling = { id: string; naam: string; volgorde: number };
export type Categorie = { id: string; naam: string; afdelingId: string | null };
export type Leverancier = { id: string; naam: string };
export type Locatie = { id: string; naam: string; type: string };
export type Onderneming = { id: string; naam: string; ondernemingsnummer: string; btwNummer: string | null; adres: string | null; isImporteur?: boolean };
export type Meta = {
  btwTarieven: BtwTarief[];
  afdelingen: Afdeling[];
  categorieen: Categorie[];
  leveranciers: Leverancier[];
  locaties: Locatie[];
  onderneming: Onderneming | null;
};

export type ProductVol = Product & {
  interneCode: string | null;
  inkoopprijs: string | null;
  eenheid: string;
  allergenen: string | null;
  actief: boolean;
  webshopZichtbaar: boolean;
  vrijePrijs: boolean;
  weegNummer: number | null;
  fotoUrl: string | null;
  afdeling: Afdeling | null;
  categorie: Categorie | null;
  leverancier: Leverancier | null;
  btwTariefId: string;
  afdelingId: string | null;
  categorieId: string | null;
  leverancierId: string | null;
  voorraad: { locatieId: string; aantal: string; locatie?: Locatie }[];
};

export type ProductInput = {
  naam: string;
  barcode?: string | null;
  interneCode?: string | null;
  verkoopprijs: number;
  inkoopprijs?: number | null;
  isAlcohol?: boolean;
  eenheid?: string;
  allergenen?: string | null;
  webshopZichtbaar?: boolean;
  fotoUrl?: string | null;
  btwTariefId: string;
  afdelingId?: string | null;
  categorieId?: string | null;
  leverancierId?: string | null;
};

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? 'Bewerking mislukt');
  }
  return res.json();
}

export async function getMeta(): Promise<Meta> {
  return (await fetch(`${BASE}/meta`)).json();
}

export async function getProductenBeheer(zoek = ''): Promise<ProductVol[]> {
  const res = await fetch(`${BASE}/producten?zoek=${encodeURIComponent(zoek)}`);
  return res.json();
}

export async function getProduct(id: string): Promise<ProductVol> {
  return (await fetch(`${BASE}/producten/${id}`)).json();
}

export async function nieuweBarcode(): Promise<string> {
  return (await (await fetch(`${BASE}/producten/nieuwe-barcode`)).json()).barcode;
}

export async function createProduct(input: ProductInput): Promise<ProductVol> {
  return jsonOrThrow(
    await fetch(`${BASE}/producten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateProduct(id: string, input: ProductInput): Promise<ProductVol> {
  return jsonOrThrow(
    await fetch(`${BASE}/producten/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

// Snel een product in/uit de webshop zetten (webshop-assortiment).
export async function setProductWebshop(id: string, zichtbaar: boolean): Promise<ProductVol> {
  return jsonOrThrow(
    await fetch(`${BASE}/producten/${id}/webshop`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zichtbaar }),
    }),
  );
}

// --- Publieke webshop-catalogus (enkel actief + webshopZichtbaar) ---
export type WebshopProduct = {
  id: string; naam: string; verkoopprijs: string; isAlcohol: boolean; eenheid: string;
  allergenen: string | null; afdelingId: string | null; fotoUrl: string | null;
  afdeling: { id: string; naam: string; volgorde: number } | null;
  categorie: { id: string; naam: string } | null;
};
export type WebshopAfdeling = { id: string; naam: string; volgorde: number; aantal: number };

export async function getWebshopProducten(afdelingId?: string): Promise<WebshopProduct[]> {
  const q = afdelingId ? `?afdelingId=${encodeURIComponent(afdelingId)}` : '';
  return (await fetch(`${BASE}/webshop/producten${q}`)).json();
}
export async function getWebshopAfdelingen(): Promise<WebshopAfdeling[]> {
  return (await fetch(`${BASE}/webshop/afdelingen`)).json();
}

// Een webshop-bestelling plaatsen (betalen bij afhaling/levering).
export type BestellingKlant = { naam: string; email: string; telefoon?: string; adres?: string };
export type BestellingBevestiging = {
  id: string; totaal: number; leverwijze: string; status: string; kortingReden?: string | null;
  lijnen: { naam: string; aantal: number; eenheidsprijs: number; totaal: number }[];
  klant?: { naam: string; email: string };
  online: boolean; betaalModus: 'TEST' | 'LIVE'; betaalUrl: string | null; betaald: boolean;
};
export async function plaatsBestelling(input: { lijnen: { productId: string; aantal: number }[]; klant: BestellingKlant; leverwijze: 'AFHALEN' | 'LEVEREN'; betaalwijze: 'ACHTERAF' | 'ONLINE' }): Promise<BestellingBevestiging> {
  return jsonOrThrow(await fetch(`${BASE}/webshop/bestelling`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}
// Testmodus: de online betaling simuleren (in LIVE gebeurt dit via Axepta).
export async function betalingAfronden(id: string, gelukt: boolean): Promise<{ betaald: boolean }> {
  return jsonOrThrow(await fetch(`${BASE}/webshop/betaling/${id}/afronden`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gelukt }),
  }));
}

// Beheer van webshop-bestellingen.
export type WebshopOrder = {
  id: string; datum: string; totaal: string; leverwijze: string | null; status: string | null; kortingReden: string | null;
  betaald: boolean; betaalRef: string | null;
  klant: { naam: string; email: string | null; adres: string | null } | null;
  lijnen: { aantal: string; eenheidsprijs: string; product: { naam: string } }[];
};
export async function getBestellingen(): Promise<WebshopOrder[]> {
  return (await fetch(`${BASE}/webshop/bestellingen`)).json();
}
export async function updateBestellingStatus(id: string, status: string): Promise<any> {
  return jsonOrThrow(await fetch(`${BASE}/webshop/bestellingen/${id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
  }));
}

export async function createCategorie(naam: string, afdelingId?: string | null): Promise<Categorie> {
  return jsonOrThrow(
    await fetch(`${BASE}/meta/categorie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam, afdelingId: afdelingId ?? null }),
    }),
  );
}
export async function createAfdeling(naam: string): Promise<Afdeling> {
  return jsonOrThrow(
    await fetch(`${BASE}/meta/afdeling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam }),
    }),
  );
}
export async function categorieNaarAfdeling(categorieId: string, afdelingId: string | null): Promise<Categorie> {
  return jsonOrThrow(
    await fetch(`${BASE}/meta/categorie/afdeling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categorieId, afdelingId }),
    }),
  );
}

export async function createLeverancier(naam: string): Promise<Leverancier> {
  return jsonOrThrow(
    await fetch(`${BASE}/meta/leverancier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam }),
    }),
  );
}

export async function voorraadOntvangst(
  productId: string,
  locatieId: string,
  aantal: number,
): Promise<void> {
  await jsonOrThrow(
    await fetch(`${BASE}/stock/ontvangst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, locatieId, aantal }),
    }),
  );
}

// --- Factuur-import ---
export type FactuurRegel = {
  omschrijving: string;
  aantal: number;
  eenheidsprijs: number;
  btwPercentage?: number;
};
export type InleesResultaat = {
  bron: 'ai' | 'lokaal';
  leverancier?: string;
  regels: FactuurRegel[];
  waarschuwing?: string;
};
export type VerwerkRegel = {
  naam: string;
  aantal: number;
  inkoopprijs: number;
  verkoopprijs: number;
  btwTariefId: string;
  isAlcohol?: boolean;
  leverancierId?: string | null;
  categorieId?: string | null;
  productId?: string | null;
};

export async function factuurInlezen(file: File): Promise<InleesResultaat> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE}/facturen/inlezen`, { method: 'POST', body: fd });
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    throw new Error(b?.message ?? 'Inlezen mislukt');
  }
  return res.json();
}

export async function factuurVerwerken(
  regels: VerwerkRegel[],
  locatieId: string,
): Promise<{ nieuw: number; bijgeboekt: number; totaal: number }> {
  return jsonOrThrow(
    await fetch(`${BASE}/facturen/verwerken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regels, locatieId }),
    }),
  );
}

// --- Scrada (facturatie/kasboek/Peppol) ---
export type ScradaStatus = {
  modus: 'test' | 'live';
  NIET_VERSTUURD: number;
  VERSTUURD: number;
  FOUT: number;
};
export type ScradaFactuur = {
  type: 'peppol_factuur' | 'kasticket';
  ticketRef: string;
  datum: string;
  onderneming: { naam: string; ondernemingsnummer: string; btwNummer: string | null };
  klant: { naam: string; btwNummer: string | null } | null;
  kanaal: string;
  betaalwijze: string | null;
  lijnen: { omschrijving: string; aantal: number; eenheidsprijsInclBtw: number; btwPercentage: number; btwBedrag: number; totaalInclBtw: number }[];
  btwPerTarief: { percentage: number; maatstaf: number; btw: number }[];
  totaalExclBtw: number;
  totaalBtw: number;
  totaalInclBtw: number;
};
export type OpenstaandeVerkoop = {
  id: string; datum: string; totaal: string; kanaal: string; betaalwijze: string | null; scradaStatus: string;
  klant: { naam: string } | null;
};

export async function getScradaStatus(): Promise<ScradaStatus> {
  return (await fetch(`${BASE}/scrada/status`)).json();
}
export async function getScradaOpenstaande(): Promise<OpenstaandeVerkoop[]> {
  return (await fetch(`${BASE}/scrada/openstaande`)).json();
}
export async function getScradaPreview(id: string): Promise<ScradaFactuur> {
  return (await fetch(`${BASE}/scrada/preview/${id}`)).json();
}
export async function scradaVerstuurEen(id: string): Promise<any> {
  return jsonOrThrow(await fetch(`${BASE}/scrada/verstuur/${id}`, { method: 'POST' }));
}
export async function scradaVerstuurAlles(): Promise<{ modus: string; gevonden: number; verstuurd: number; mislukt: number }> {
  return jsonOrThrow(await fetch(`${BASE}/scrada/verstuur`, { method: 'POST' }));
}

// --- Weeg-etiket ---
export type WeegEtiket = {
  productId: string; naam: string; weegNummer: number; eenheidsprijs: number;
  gewicht: number; gram: number; prijs: number; barcode: string; zpl: string;
};
export async function getWeegEtiket(productId: string, gewicht: number): Promise<WeegEtiket> {
  return jsonOrThrow(
    await fetch(`${BASE}/weeg/etiket`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, gewicht }),
    }),
  );
}

// --- Kortingen (personeel / friends & family) ---
export type Kortingsregeling = { id: string; naam: string; pct: string; actief: boolean };
export type Begunstigde = {
  id: string;
  email: string;
  naam: string | null;
  regelingId: string;
  regeling?: Kortingsregeling;
};

export async function getKortingsregelingen(): Promise<Kortingsregeling[]> {
  return (await fetch(`${BASE}/kortingen/regelingen`)).json();
}
export async function nieuweKortingsregeling(input: { naam: string; pct: number }): Promise<Kortingsregeling> {
  return jsonOrThrow(
    await fetch(`${BASE}/kortingen/regelingen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}
export async function getBegunstigden(zoek?: string): Promise<Begunstigde[]> {
  const q = zoek ? `?zoek=${encodeURIComponent(zoek)}` : '';
  return (await fetch(`${BASE}/kortingen/begunstigden${q}`)).json();
}
export async function nieuweBegunstigde(input: { email: string; naam?: string; regelingId: string }): Promise<Begunstigde> {
  return jsonOrThrow(
    await fetch(`${BASE}/kortingen/begunstigden`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}
export async function verwijderBegunstigde(id: string): Promise<any> {
  return jsonOrThrow(await fetch(`${BASE}/kortingen/begunstigden/${id}`, { method: 'DELETE' }));
}
export async function kortingVoorEmail(email: string): Promise<Kortingsregeling | null> {
  return (await fetch(`${BASE}/kortingen/voor-email?email=${encodeURIComponent(email)}`)).json();
}

// --- Website-inhoud (publieke site, zelf aanpasbaar) ---
export type Openingsuur = { id: string; dag: number; gesloten: boolean; van: string | null; tot: string | null };
export type SitePartner = { id: string; naam: string; website: string | null; logoUrl: string | null; volgorde: number };
export type SiteInhoud = { teksten: Record<string, string>; openingsuren: Openingsuur[]; partners: SitePartner[] };

export async function getSiteInhoud(): Promise<SiteInhoud> {
  return (await fetch(`${BASE}/site/inhoud`)).json();
}
export async function zetSiteTeksten(teksten: Record<string, string>): Promise<SiteInhoud> {
  return jsonOrThrow(await fetch(`${BASE}/site/teksten`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(teksten),
  }));
}
export async function zetOpeningsuren(openingsuren: { dag: number; gesloten: boolean; van?: string | null; tot?: string | null }[]): Promise<Openingsuur[]> {
  return jsonOrThrow(await fetch(`${BASE}/site/openingsuren`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openingsuren }),
  }));
}
export async function nieuwePartner(input: { naam: string; website?: string | null; volgorde?: number }): Promise<SitePartner> {
  return jsonOrThrow(await fetch(`${BASE}/site/partners`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}
export async function updatePartner(id: string, input: { naam?: string; website?: string | null; logoUrl?: string | null; volgorde?: number }): Promise<SitePartner> {
  return jsonOrThrow(await fetch(`${BASE}/site/partners/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}
export async function verwijderPartner(id: string): Promise<any> {
  return jsonOrThrow(await fetch(`${BASE}/site/partners/${id}`, { method: 'DELETE' }));
}
// Afbeelding uploaden -> { id, url }. url is te gebruiken als <img src>.
export async function uploadSiteAfbeelding(bestand: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append('bestand', bestand);
  return jsonOrThrow(await fetch(`${BASE}/site/afbeelding`, { method: 'POST', body: fd }));
}

// --- Lopende rekeningen (B2B "op rekening") ---
export type RekeningLid = { id: string; naam: string; budget?: number | null; actief?: boolean; verbruikt?: number };
export type RekeningBedrijf = {
  id: string; naam: string; btwNummer?: string | null; adres?: string | null; email?: string | null;
  actief?: boolean; openstaand?: number; leden: RekeningLid[];
};
export type RekeningVerkoop = { id: string; datum: string; totaal: number; gefactureerd: boolean; lid: string | null; artikels: string[] };

export async function getRekeningenKassa(): Promise<RekeningBedrijf[]> {
  return (await fetch(`${BASE}/rekeningen/kassa`)).json();
}
export async function getRekeningOverzicht(): Promise<RekeningBedrijf[]> {
  return (await fetch(`${BASE}/rekeningen/overzicht`)).json();
}
export async function nieuwRekeningBedrijf(input: { naam: string; btwNummer?: string; adres?: string; email?: string }): Promise<RekeningBedrijf> {
  return jsonOrThrow(await fetch(`${BASE}/rekeningen/bedrijven`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function updateRekeningBedrijf(id: string, input: any): Promise<RekeningBedrijf> {
  return jsonOrThrow(await fetch(`${BASE}/rekeningen/bedrijven/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function nieuwRekeningLid(input: { bedrijfId: string; naam: string; budget?: number }): Promise<RekeningLid> {
  return jsonOrThrow(await fetch(`${BASE}/rekeningen/leden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function updateRekeningLid(id: string, input: any): Promise<RekeningLid> {
  return jsonOrThrow(await fetch(`${BASE}/rekeningen/leden/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function getBedrijfVerkopen(id: string): Promise<RekeningVerkoop[]> {
  return (await fetch(`${BASE}/rekeningen/bedrijven/${id}/verkopen`)).json();
}
export async function factureerBedrijf(id: string): Promise<{ aantal: number; totaal: number }> {
  return jsonOrThrow(await fetch(`${BASE}/rekeningen/bedrijven/${id}/factureer`, { method: 'POST' }));
}
// Een (nog niet gefactureerde) verkoop verschuiven naar een andere rekening (bedrijf + lid).
export async function verplaatsRekeningVerkoop(verkoopId: string, bedrijfId: string, lidId: string): Promise<{ ok: true }> {
  return jsonOrThrow(await fetch(`${BASE}/rekeningen/verkopen/${verkoopId}/verplaats`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bedrijfId, lidId }) }));
}
