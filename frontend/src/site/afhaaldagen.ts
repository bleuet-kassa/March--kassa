// Datums voor de afhaal- en leverdagen van de webshop. Welke dagen kunnen, bepaalt de server
// (openingsuren + webshopkalender + minimum dagen vooraf).

export const vandaagBrussel = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());

export const dagNaam = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
