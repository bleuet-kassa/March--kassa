import type { SiteInhoud } from '../api/client';

// Standaardteksten van de juridische pagina's. Aanpasbaar in de kassa (Website → Juridische
// teksten): wat daar bewaard wordt, vervangt de standaardtekst (SiteTekst `sleutel`).
// Opmaak: "## " = kop, "- " = opsomming, lege regel = nieuwe alinea.
// {bedrijf}, {adres}, {ondernemingsnummer}, {btw}, {email} en {telefoon} worden ingevuld
// vanuit de ondernemingsgegevens en de contactgegevens. [Tussen haken] = nog in te vullen.
export type JuridischSoort = 'privacy' | 'voorwaarden' | 'herroeping';

export const JURIDISCH: Record<JuridischSoort, { sleutel: string; titel: string; pad: string; tekst: string }> = {
  privacy: {
    sleutel: 'juridisch_privacy',
    titel: 'Privacyverklaring',
    pad: '/privacy',
    tekst: `Laatst bijgewerkt op 5 november 2026.

## Wie is verantwoordelijk voor je gegevens?
{bedrijf}, {adres}, ondernemingsnummer {ondernemingsnummer}, is verantwoordelijk voor de persoonsgegevens die via deze website en webshop van Marché verwerkt worden. Met vragen over je gegevens kan je terecht bij {email} of {telefoon}.

## Welke gegevens we verwerken
- Bij een bestelling: je naam, e-mailadres, eventueel je telefoonnummer, je leveradres als je laat leveren, wat je bestelt, het bedrag, de gewenste afhaal- of leverdatum en de status van je betaling. Je kaart- of bankgegevens krijgen wij niet te zien.
- Bij een herroeping: je naam, e-mailadres, de gegevens van je bestelling en je eventuele toelichting.
- Als je ons mailt of belt: wat je ons zelf meedeelt.
- Bij elk bezoek: technische gegevens zoals je IP-adres. Die zijn nodig om de website te laten werken en misbruik tegen te gaan.

## Waarom we dat doen
- Om je bestelling klaar te zetten of te leveren en je erover te contacteren. Dat is nodig om de overeenkomst met jou uit te voeren.
- Om onze boekhoudkundige en fiscale verplichtingen na te leven. Dat is een wettelijke verplichting.
- Om de website te beveiligen en misbruik te voorkomen. Dat is ons gerechtvaardigd belang.

We gebruiken de gegevens uit de webshop niet voor reclame of nieuwsbrieven en we verkopen ze aan niemand.

## Cookies en trackers
De website en de webshop gebruiken geen cookies voor statistieken of reclame en geen trackers van andere bedrijven. Je winkelmandje staat alleen in het geopende venster en wordt niet bewaard tot je bestelt.

## Wie je gegevens te zien krijgt
- Onze medewerkers die bestellingen behandelen.
- Render, dat de website en de database voor ons host. De gegevens staan op servers in Frankfurt (Duitsland). Render is een Amerikaans bedrijf.
- Mollie B.V. (Nederland), die je online betaling afhandelt. Op de betaalpagina geef je je betaalgegevens rechtstreeks aan Mollie.
- Combell, voor ons domein en onze e-mail.
- Scrada en onze boekhouder, voor onze boekhouding.
- Overheidsdiensten, als de wet ons daartoe verplicht.

## Hoe lang we je gegevens bewaren
- Betaalde bestellingen en facturen: zolang de boekhoud- en btw-regels dat vereisen, in principe 10 jaar.
- Bestellingen die niet betaald werden: we wissen ze na 30 dagen.
- Herroepingen, vragen en klachten: zolang nodig om ze af te handelen en een eventueel geschil op te lossen.
- Technische gegevens: niet langer dan nodig voor de beveiliging.

## Je rechten
Je kan je gegevens inkijken en laten verbeteren of wissen, de verwerking laten beperken, bezwaar maken en je gegevens opvragen om ze aan iemand anders te bezorgen. Gegevens die we wettelijk moeten bewaren, kunnen we pas na die termijn wissen. Stuur je vraag naar {email}. We antwoorden binnen een maand.

Ben je niet tevreden over hoe we met je gegevens omgaan? Dan kan je een klacht indienen bij de Gegevensbeschermingsautoriteit (www.gegevensbeschermingsautoriteit.be).

## Wijzigingen
Passen we deze verklaring aan, dan vind je de nieuwe versie altijd op deze pagina.`,
  },
  voorwaarden: {
    sleutel: 'juridisch_voorwaarden',
    titel: 'Algemene voorwaarden',
    pad: '/voorwaarden',
    tekst: `Laatst bijgewerkt op 5 november 2026.

## Wie we zijn
De webshop Marché wordt uitgebaat door {bedrijf}, {adres}, ondernemingsnummer {ondernemingsnummer}, btw-nummer {btw}. Je bereikt ons via {email} of {telefoon}.

## Wanneer deze voorwaarden gelden
Deze voorwaarden gelden voor elke bestelling via de webshop. Je gaat ermee akkoord wanneer je bestelt. Je wettelijke rechten als consument blijven altijd gelden.

## Aanbod en prijzen
Alle prijzen zijn in euro en inclusief btw. Foto's dienen als illustratie; een artikel kan er licht anders uitzien. De prijs die je ziet op het moment van je bestelling is de prijs die je betaalt.

Op sommige artikels staat statiegeld. Dat bedrag zie je bij het artikel en in je mandje, en het zit in het totaal. Je krijgt het terug als tegoedbon wanneer je het leeggoed naar de winkel brengt.

## Je bestelling
Je bestelling is geplaatst zodra je op "Bestellen met betalingsverplichting" klikt en de betaling gelukt is. Zonder betaling is er geen bestelling. Je ziet de bevestiging op het scherm en ontvangt ze ook per e-mail. Is een artikel toch niet beschikbaar, dan nemen we contact met je op en betalen we dat artikel terug.

Wil je iets wijzigen of annuleren? Neem dan zo snel mogelijk contact met ons op. Zolang we nog niet aan je bestelling begonnen zijn, betalen we je alles terug.

## Afhalen en leveren
Bij het bestellen kies je een afhaal- of leverdag uit de dagen die we aanbieden. Daar zie je ook hoeveel dagen op voorhand je moet bestellen. Leveren kan enkel op de dagen waarop we leveren aanbieden.

[Vul in: in welke gemeenten je levert en wat een levering kost.]

Haal je een bereid gerecht niet af en hoorden we niets van je, dan betalen we het niet terug.

## Betaling
Je betaalt online bij het bestellen, op de beveiligde betaalpagina van onze betaalpartner Mollie, met de betaalmethoden die je daar ziet. Betalen in de winkel of bij de levering kan niet. Terugbetalingen gebeuren via dezelfde betaalmethode.

## Allergenen
Bij elk voedingsartikel vermelden we de allergenen. Staat er "vraag het ons", of heb je een allergie of intolerantie? Neem dan vóór je bestelt contact met ons op. In onze keuken en winkel werken we met veel verschillende ingrediënten, waardoor sporen van allergenen nooit helemaal uit te sluiten zijn.

## Alcohol
Wijn en bier verkopen we niet aan wie jonger is dan 16 jaar, sterke drank niet aan wie jonger is dan 18 jaar. We kunnen bij het afhalen of leveren je identiteitskaart vragen en de alcohol weigeren als je de leeftijd niet kan aantonen.

## Herroepingsrecht
Voor sommige aankopen heb je 14 dagen herroepingsrecht. Verse voeding en bereide gerechten zijn daarvan uitgesloten. Alles daarover vind je op de pagina Herroepingsrecht.

## Als er iets niet in orde is
Is een artikel niet in orde? Laat het ons dan zo snel mogelijk weten, dan zoeken we samen een oplossing. Bij verse producten vragen we je dat meteen te doen, liefst op de dag van ontvangst. Je wettelijke garantie blijft altijd gelden.

We zijn niet aansprakelijk voor indirecte schade, behalve bij opzet of zware fout. Dit beperkt je dwingende rechten als consument niet.

## Klachten
Stuur je klacht naar {email}, dan zoeken we eerst samen een oplossing. Lukt dat niet, dan kan je terecht bij de Consumentenombudsdienst (consumentenombudsdienst.be). Een probleem melden kan ook bij de FOD Economie (consumerconnect.economie.fgov.be).

## Toepasselijk recht
Op deze voorwaarden is het Belgische recht van toepassing. Bij een geschil zijn de rechtbanken bevoegd die de wet aanduidt. Je rechten als consument blijven gelden.`,
  },
  herroeping: {
    sleutel: 'juridisch_herroeping',
    titel: 'Herroepingsrecht',
    pad: '/herroeping',
    tekst: `Deze regels gelden voor consumenten, dus niet voor aankopen voor je bedrijf. Laatst bijgewerkt op 5 november 2026.

## Hoe lang kan je herroepen?
Je mag een online aankoop binnen 14 dagen herroepen, zonder een reden te geven. Die termijn loopt tot 14 dagen na de dag waarop jij, of iemand die je daarvoor aanduidt, het goed ontvangt. Komen de artikels van één bestelling apart toe, dan telt de dag waarop je het laatste ontvangt.

## Waarvoor geldt het niet?
Het herroepingsrecht geldt niet voor:
- goederen die snel bederven of beperkt houdbaar zijn, zoals verse groenten en fruit, vlees, vis, kaas en traiteurgerechten;
- goederen die op jouw vraag op maat gemaakt of bereid zijn;
- verzegelde goederen die om gezondheids- of hygiëneredenen niet teruggestuurd kunnen worden en waarvan de verzegeling na de levering verbroken is;
- goederen die na de levering onlosmakelijk vermengd zijn met andere producten;
- alcoholische dranken waarvan de prijs bij de aankoop werd afgesproken, die pas na 30 dagen geleverd kunnen worden en waarvan de waarde afhangt van marktschommelingen;
- catering op een bepaalde datum of in een bepaalde periode.

## Hoe herroep je?
Gebruik de knop bovenaan deze pagina. Je mag je beslissing ook op een andere duidelijke manier meedelen aan {bedrijf}, {adres}, {email}, {telefoon}, bijvoorbeeld per e-mail of per brief. Daarvoor kan je het modelformulier hieronder gebruiken, maar dat hoeft niet. Je bent op tijd als je je beslissing meedeelt vóór de termijn afloopt.

## Wat gebeurt er daarna?
We betalen je alles terug, ook de standaardleveringskosten, uiterlijk 14 dagen nadat we je herroeping ontvingen. We gebruiken daarvoor hetzelfde betaalmiddel als jij, tenzij we iets anders afspreken. We mogen wachten met terugbetalen tot we de goederen terug hebben of tot je kan aantonen dat je ze teruggestuurd hebt.

Breng de goederen terug naar de winkel of stuur ze ons terug, uiterlijk 14 dagen nadat je ons je herroeping meedeelde. De kosten van het terugsturen zijn voor jou. Je betaalt alleen voor waardevermindering als die komt doordat je de goederen meer gebruikte dan nodig was om ze te bekijken.

## Modelformulier voor herroeping
Vul dit formulier alleen in als je de overeenkomst wil herroepen en dit niet via de knop bovenaan doet.

Aan {bedrijf}, {adres}, {email}:

Ik/Wij (*) deel/delen (*) u hierbij mede dat ik/wij (*) onze overeenkomst betreffende de verkoop van de volgende goederen/levering van de volgende dienst (*) herroep/herroepen (*):
- Besteld op (*)/ontvangen op (*):
- Naam/Namen consument(en):
- Adres consument(en):
- Handtekening van consument(en) (alleen als dit formulier op papier wordt ingediend):
- Datum:

(*) Doorhalen wat niet van toepassing is.`,
  },
};

// De bewaarde tekst, of anders de standaardtekst.
export function juridischeTekst(soort: JuridischSoort, inhoud: SiteInhoud | null) {
  return inhoud?.teksten[JURIDISCH[soort].sleutel] || JURIDISCH[soort].tekst;
}

// Vult de gegevens van de zaak in. Ontbreekt er iets, dan blijft dat zichtbaar als nog in te vullen.
export function vulGegevensIn(tekst: string, inhoud: SiteInhoud | null) {
  const o = inhoud?.onderneming;
  const t = inhoud?.teksten ?? {};
  const waarden: Record<string, string | null | undefined> = {
    bedrijf: o?.naam, adres: o?.adres || t.contact_adres, ondernemingsnummer: o?.ondernemingsnummer,
    btw: o?.btwNummer, email: t.contact_email, telefoon: t.contact_telefoon,
  };
  return tekst.replace(/\{(\w+)\}/g, (heel, sleutel: string) => (sleutel in waarden ? waarden[sleutel] || `[${sleutel} ontbreekt]` : heel));
}
