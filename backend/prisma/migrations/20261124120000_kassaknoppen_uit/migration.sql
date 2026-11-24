-- De kassaknoppen "Diversen" (per btw-voet) en "Prijs/kg" zijn afgeschaft (klantvraag
-- 2026-11-24): de artikels achter die knoppen mogen niet meer gebruikt worden. Enkel
-- vrij-bedrag-artikels met die interne codes; eerdere verkopen blijven gewoon staan.
UPDATE "Product" SET "actief" = false
WHERE "vrijePrijs" = true AND ("interneCode" LIKE 'DIV%' OR "interneCode" = 'PRIJSKG');
