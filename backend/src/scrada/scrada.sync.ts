import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { ScradaService, SYNC_UUR } from './scrada.service';
import { ScradaDagboekService } from './scrada.dagboek.service';
import { boekdatumVan } from '../common/kassadag';

// Dagelijkse HERINNERING om 23:59 (Europe/Brussels). Er wordt NIETS automatisch
// verstuurd: de beheerder bevestigt het versturen altijd zelf. Staan er
// afgesloten dagen vanaf de startdatum nog niet in Scrada, dan krijgt hij een
// pushmelding met een link naar de bevestigpagina (daar staat de knop
// "Naar Scrada sturen"). Hoogstens één herinnering per dag; het verslag van
// de laatste run staat in Instelling "scrada.laatsteSync".
@Injectable()
export class ScradaSync implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ScradaSync.name);
  private timer?: NodeJS.Timeout;
  private bezig = false;

  constructor(
    private prisma: PrismaService,
    private push: PushService,
    private scrada: ScradaService,
    private dagboek: ScradaDagboekService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.tik(); }, 60_000);
    this.log.log(`Scrada-herinnering gepland: dagelijks om ${SYNC_UUR} (Europe/Brussels).`);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Datum (JJJJ-MM-DD) en tijd (UU:MM) volgens de klok in Brussel.
  private brussel(): { datum: string; tijd: string } {
    const delen = new Intl.DateTimeFormat('nl-BE', {
      timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const p = (t: string) => delen.find((d) => d.type === t)?.value ?? '';
    return { datum: `${p('year')}-${p('month')}-${p('day')}`, tijd: `${p('hour')}:${p('minute')}` };
  }

  private async tik() {
    if (this.bezig) return;
    const { datum, tijd } = this.brussel();
    if (tijd !== SYNC_UUR) return;
    const laatste = await this.prisma.instelling.findUnique({ where: { sleutel: 'scrada.laatsteSync' } });
    let vorige: { datum?: string } = {};
    try { vorige = laatste?.waarde ? JSON.parse(laatste.waarde) : {}; } catch { vorige = {}; }
    if (vorige.datum === datum) return; // vandaag al gedaan

    this.bezig = true;
    try {
      const r = await this.herinner();
      const verslag = { datum, moment: new Date().toISOString(), modus: 'herinnering', ...r };
      await this.prisma.instelling.upsert({
        where: { sleutel: 'scrada.laatsteSync' },
        create: { sleutel: 'scrada.laatsteSync', waarde: JSON.stringify(verslag) },
        update: { waarde: JSON.stringify(verslag) },
      });
      this.log.log(`Scrada-herinnering ${datum} ${SYNC_UUR}: ${JSON.stringify(r)}`);
    } catch (e) {
      this.log.error(`Scrada-herinnering mislukt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.bezig = false;
    }
  }

  // Zoekt de nog niet verstuurde dagen (vanaf de startdatum) en stuurt één
  // melding naar de beheerder(s), met een link naar de oudste openstaande dag.
  async herinner() {
    const vanaf = await this.scrada.vanaf();
    if (!vanaf) return { geweigerd: true, melding: 'Geen startdatum ingesteld.', dagen: 0 };
    const open = await this.prisma.dagafsluiting.findMany({
      where: { tot: { gte: vanaf }, scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } },
      orderBy: { tot: 'asc' },
    });
    // Ook facturen die klaarstaan (nog niet in Scrada) of tickets die nog een factuur moeten krijgen.
    const [facturenOpen, ticketsZonderFactuur] = await Promise.all([
      this.prisma.verkoopfactuur.count({ where: { datum: { gte: vanaf }, scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } } }),
      this.prisma.verkoop.count({ where: { factuurGewenst: true, factuurId: null, geannuleerd: false } }),
    ]);
    const facturen = facturenOpen + ticketsZonderFactuur;
    if (!open.length && !facturen) return { dagen: 0, facturen: 0, melding: 'Alle afgesloten dagen en facturen staan in Scrada.' };
    const basis = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
    // Link naar de oudste openstaande dag; zijn er enkel facturen, dan naar de laatste afgesloten dag.
    const doel = open[0] ?? (await this.prisma.dagafsluiting.findFirst({ orderBy: { tot: 'desc' } }));
    const url = doel ? `${basis}/bevestig-afsluiting/${await this.dagboek.tokenVoorDag(doel.id)}` : `${basis}/kassa/boekhouding`;
    // Kassadag (niet het afsluitmoment): afsluiten na middernacht hoort nog bij de vorige dag.
    const datumNl = open[0] ? boekdatumVan(open[0]).split('-').reverse().join('/') : undefined;
    const delen: string[] = [];
    if (open.length === 1) delen.push(`Dagafsluiting${open[0].volgnummer ? ` #${open[0].volgnummer}` : ''} van ${datumNl} (€ ${Number(open[0].totaal).toFixed(2)}) staat nog niet in Scrada.`);
    else if (open.length > 1) delen.push(`${open.length} afgesloten dagen staan nog niet in Scrada (oudste: ${datumNl}).`);
    if (facturen) delen.push(`${facturen} factu${facturen === 1 ? 'ur' : 'ren'} klaar om als concept naar Scrada te gaan.`);
    const push = await this.push.naarBeheerders({
      titel: 'Scrada — bevestiging gevraagd',
      tekst: `${delen.join(' ')} Tik om te bevestigen.`,
      url,
      tag: 'scrada',
    });
    return { dagen: open.length, facturen, push };
  }
}
