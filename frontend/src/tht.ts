// Moet een nieuw artikel bij ontvangst een THT krijgen? Klantregel: niet voor non-food, wijn en
// groenten (per artikel aan of uit te zetten). In de wijnkelder hebben bier, frisdrank, tonics,
// siropen, koekjes en alcoholvrije dranken wél een THT; wijn en sterke drank niet.
// Zelfde regel als de server (backend/src/common/tht.ts).
const GEEN_THT_AFDELING = /^(onderhoud|private hygi|lifestyle|groente)/i;
const WIJN_AFDELING = /^wijn/i;
const MET_THT_IN_WIJNKELDER = /^(bier|frisdrank|overig)/i;
const ACCESSOIRE = /coravin|vacu ?vin/i;
const ALCOHOLVRIJ = /(^|[^0-9.,])0 ?%|non[ -]?alcoholic|alcoholvrij|alcohol[ -]?free/i;

export function thtStandaard(afdeling?: string | null, categorie?: string | null, naam?: string | null): boolean {
  const a = (afdeling ?? '').trim();
  if (GEEN_THT_AFDELING.test(a)) return false;
  if (!WIJN_AFDELING.test(a)) return true;
  const n = naam ?? '';
  if (ACCESSOIRE.test(n)) return false;
  return MET_THT_IN_WIJNKELDER.test((categorie ?? '').trim()) || ALCOHOLVRIJ.test(n);
}
