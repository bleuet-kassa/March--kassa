import { Prisma } from '@prisma/client';

// Cadeaubonnummers CB00001, CB00002, … uit één teller (Instelling 'cadeaubon.volgnummer' = het
// laatst uitgegeven nummer). Ophogen gebeurt in één SQL-opdracht die de tellerrij vergrendelt tot
// het einde van de transactie: twee kassa's tegelijk krijgen dus nooit hetzelfde nummer. De teller
// springt altijd voorbij het hoogste bestaande CB-nummer, ook als iemand er een met de hand ingaf.
const SLEUTEL = 'cadeaubon.volgnummer';
type Db = { $queryRaw: (q: TemplateStringsArray | Prisma.Sql, ...v: unknown[]) => Promise<unknown> };

const formaat = (n: number) => 'CB' + String(n).padStart(5, '0');

export async function volgendCadeaubonnummer(db: Db): Promise<string> {
  const rijen = (await db.$queryRaw`
    INSERT INTO "Instelling" ("sleutel", "waarde", "updatedAt")
    VALUES (${SLEUTEL}, (SELECT (COALESCE(MAX(CAST(SUBSTRING("nummer" FROM 3) AS INTEGER)), 0) + 1)::text FROM "Cadeaubon" WHERE "nummer" ~ '^CB[0-9]{1,9}$'), NOW())
    ON CONFLICT ("sleutel") DO UPDATE SET
      "waarde" = GREATEST(
        CAST("Instelling"."waarde" AS INTEGER) + 1,
        (SELECT COALESCE(MAX(CAST(SUBSTRING("nummer" FROM 3) AS INTEGER)), 0) + 1 FROM "Cadeaubon" WHERE "nummer" ~ '^CB[0-9]{1,9}$')
      )::text,
      "updatedAt" = NOW()
    RETURNING "waarde"`) as { waarde: string }[];
  return formaat(Number(rijen[0].waarde));
}

// Het nummer dat de volgende bon zal krijgen (enkel tonen, zonder op te hogen).
export async function voorgesteldCadeaubonnummer(db: Db): Promise<string> {
  const rijen = (await db.$queryRaw`
    SELECT GREATEST(
      COALESCE((SELECT CAST("waarde" AS INTEGER) FROM "Instelling" WHERE "sleutel" = ${SLEUTEL}), 0) + 1,
      (SELECT COALESCE(MAX(CAST(SUBSTRING("nummer" FROM 3) AS INTEGER)), 0) + 1 FROM "Cadeaubon" WHERE "nummer" ~ '^CB[0-9]{1,9}$')
    ) AS "n"`) as { n: number | bigint }[];
  return formaat(Number(rijen[0].n));
}
