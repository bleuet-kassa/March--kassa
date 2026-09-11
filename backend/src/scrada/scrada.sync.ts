import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScradaService, SYNC_UUR } from './scrada.service';

// Dagelijkse automatische synchronisatie naar Scrada om 23:59 (Belgische tijd).
// Elke minuut kijken we op de klok van Europe/Brussels; precies om SYNC_UUR
// (en hoogstens één keer per dag) worden alle openstaande verkopen vanaf de
// startdatum verstuurd. Dedup op receiptID maakt een dubbele run onschadelijk.
// Het verslag van de laatste run staat in Instelling "scrada.laatsteSync".
@Injectable()
export class ScradaSync implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ScradaSync.name);
  private timer?: NodeJS.Timeout;
  private bezig = false;

  constructor(private prisma: PrismaService, private scrada: ScradaService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.tik(); }, 60_000);
    this.log.log(`Automatische Scrada-synchronisatie gepland: dagelijks om ${SYNC_UUR} (Europe/Brussels).`);
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
    // Vandaag al gedaan? (bewaard in de database, dus ook robuust bij een herstart)
    const laatste = await this.prisma.instelling.findUnique({ where: { sleutel: 'scrada.laatsteSync' } });
    let vorige: { datum?: string } = {};
    try { vorige = laatste?.waarde ? JSON.parse(laatste.waarde) : {}; } catch { vorige = {}; }
    if (vorige.datum === datum) return;

    this.bezig = true;
    try {
      const r = await this.scrada.verstuurOpenstaande();
      const verslag = { datum, moment: new Date().toISOString(), ...r };
      await this.prisma.instelling.upsert({
        where: { sleutel: 'scrada.laatsteSync' },
        create: { sleutel: 'scrada.laatsteSync', waarde: JSON.stringify(verslag) },
        update: { waarde: JSON.stringify(verslag) },
      });
      this.log.log(`Scrada-synchronisatie ${datum} ${SYNC_UUR}: ${JSON.stringify(r)}`);
    } catch (e) {
      this.log.error(`Scrada-synchronisatie mislukt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.bezig = false;
    }
  }
}
