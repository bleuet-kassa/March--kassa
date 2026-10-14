import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

// Spreuk van de dag op het startscherm van de kassa.
//  - Startreeks (SEED) wordt bij de eerste start ingeladen.
//  - Elke week (maandag 06:00 Brussel) vraagt de kassa aan Claude 7 nieuwe spreuken
//    in dezelfde toon (AI), zodat de lijst blijft groeien. Vereist ANTHROPIC_API_KEY
//    (dezelfde sleutel als "Facturen inlezen"); zonder sleutel gebeurt er niets.
//  - Beheer op Instellingen: toevoegen, uitzetten, verwijderen, nu aanvullen.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const AANVUL_DAG = 1; // maandag
const AANVUL_UUR = '06:00';
const SLEUTEL = 'spreuken.laatsteAanvulling';

export const SEED: { tekst: string; auteur: string; emoji: string }[] = [
  { tekst: 'Een glimlach kost niets en is het beste wat we vandaag in de rekken hebben.', auteur: 'Marché', emoji: '😊' },
  { tekst: 'Vers begint bij goeiemorgen.', auteur: 'Marché', emoji: '🌅' },
  { tekst: 'Doe gewoon wat je kan, met wat je hebt, waar je bent.', auteur: 'Theodore Roosevelt', emoji: '💪' },
  { tekst: 'De klant onthoudt niet wat je zei, wel hoe je hem deed voelen.', auteur: 'naar Maya Angelou', emoji: '💛' },
  { tekst: 'Kleine dingen, goed gedaan, maken de grote dag.', auteur: 'Marché', emoji: '🧺' },
  { tekst: 'Koffie eerst. Dan de wereld.', auteur: 'onbekend', emoji: '☕' },
  { tekst: 'Elke dag is een nieuwe kans om iemand een beetje blijer te maken.', auteur: 'Marché', emoji: '🌿' },
  { tekst: 'Wie zaait met zorg, oogst met plezier.', auteur: 'boerenwijsheid', emoji: '🥕' },
  { tekst: 'Een goede dag begint met een goed humeur. De rest komt vanzelf.', auteur: 'Marché', emoji: '🍋' },
  { tekst: 'Het is niet de berg die we overwinnen, maar onszelf.', auteur: 'Edmund Hillary', emoji: '⛰️' },
  { tekst: 'Lachen is gezond. Fruit ook. Combineer.', auteur: 'Marché', emoji: '🍓' },
  { tekst: 'Niets is onmogelijk voor wie met goesting begint.', auteur: 'Vlaamse wijsheid', emoji: '🚀' },
];

@Injectable()
export class SpreukenService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SpreukenService.name);
  private timer?: NodeJS.Timeout;
  private bezig = false;
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try { await this.seed(); } catch (e) { this.log.warn(`Spreuken seed: ${e instanceof Error ? e.message : e}`); }
    this.timer = setInterval(() => { void this.tik(); }, 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async seed() {
    const n = await this.prisma.spreuk.count();
    if (n > 0) return;
    await this.prisma.spreuk.createMany({ data: SEED.map((s) => ({ ...s, bron: 'SEED' })), skipDuplicates: true });
    this.log.log(`Spreuken: startreeks van ${SEED.length} ingeladen.`);
  }

  private brussel() {
    const d = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const p = (t: string) => d.find((x) => x.type === t)?.value ?? '';
    const datum = `${p('year')}-${p('month')}-${p('day')}`;
    return { datum, tijd: `${p('hour')}:${p('minute')}`, weekdag: new Date(datum + 'T12:00:00Z').getUTCDay() };
  }

  // Wekelijkse aanvulling (maandag 06:00), één keer per dag gecontroleerd.
  private async tik() {
    if (this.bezig) return;
    const { datum, tijd, weekdag } = this.brussel();
    if (weekdag !== AANVUL_DAG || tijd !== AANVUL_UUR) return;
    const laatste = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL } });
    let vorige: { datum?: string } = {};
    try { vorige = laatste?.waarde ? JSON.parse(laatste.waarde) : {}; } catch { vorige = {}; }
    if (vorige.datum === datum) return;
    this.bezig = true;
    try { await this.aanvullen(7, 'automatisch'); }
    catch (e) { this.log.warn(`Spreuken aanvullen mislukt: ${e instanceof Error ? e.message : e}`); }
    finally { this.bezig = false; }
  }

  // --- lezen ---------------------------------------------------------------------
  // Spreuk van de dag: vaste keuze per kalenderdag (iedereen ziet dezelfde), plus
  // enkele andere voor de carrousel.
  async vanDaag() {
    const actief = await this.prisma.spreuk.findMany({ where: { actief: true }, orderBy: { createdAt: 'asc' } });
    if (!actief.length) return { vandaag: null, carrousel: [], datum: this.brussel().datum };
    const { datum } = this.brussel();
    const dagNr = Math.floor(new Date(datum + 'T12:00:00Z').getTime() / 86_400_000);
    const i = dagNr % actief.length;
    const vandaag = actief[i];
    // Carrousel: de spreuk van vandaag eerst, dan 5 andere (vast per dag, geen dubbels).
    const rest = actief.filter((s) => s.id !== vandaag.id);
    const carrousel = [vandaag];
    for (let k = 1; k <= Math.min(5, rest.length); k++) carrousel.push(rest[(i * 7 + k * 3) % rest.length]);
    const uniek = carrousel.filter((s, idx, arr) => arr.findIndex((x) => x.id === s.id) === idx);
    return { vandaag: this.naarBuiten(vandaag), carrousel: uniek.map((s) => this.naarBuiten(s)), datum };
  }
  private naarBuiten(s: { id: string; tekst: string; auteur: string | null; emoji: string | null; bron: string; actief: boolean; createdAt: Date }) {
    return { id: s.id, tekst: s.tekst, auteur: s.auteur, emoji: s.emoji, bron: s.bron, actief: s.actief, createdAt: s.createdAt };
  }

  // --- beheer --------------------------------------------------------------------
  async lijst() {
    const [rows, laatste] = await Promise.all([
      this.prisma.spreuk.findMany({ orderBy: [{ actief: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL } }),
    ]);
    let aanvulling: unknown = null;
    try { aanvulling = laatste?.waarde ? JSON.parse(laatste.waarde) : null; } catch { aanvulling = null; }
    return { spreuken: rows.map((s) => this.naarBuiten(s)), aiBeschikbaar: !!process.env.ANTHROPIC_API_KEY, laatsteAanvulling: aanvulling, planning: `elke maandag om ${AANVUL_UUR} (7 nieuwe)` };
  }
  async toevoegen(input: { tekst: string; auteur?: string | null; emoji?: string | null }) {
    const tekst = String(input.tekst ?? '').trim();
    if (tekst.length < 5) throw new BadRequestException('Geef een spreuk van minstens 5 tekens.');
    const bestaat = await this.prisma.spreuk.findUnique({ where: { tekst } });
    if (bestaat) throw new BadRequestException('Deze spreuk staat er al in.');
    return this.naarBuiten(await this.prisma.spreuk.create({ data: { tekst, auteur: input.auteur?.trim() || null, emoji: input.emoji?.trim() || null, bron: 'MANUEEL' } }));
  }
  async zetActief(id: string, actief: boolean) {
    const s = await this.prisma.spreuk.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Spreuk niet gevonden.');
    return this.naarBuiten(await this.prisma.spreuk.update({ where: { id }, data: { actief } }));
  }
  async verwijder(id: string) {
    const s = await this.prisma.spreuk.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Spreuk niet gevonden.');
    await this.prisma.spreuk.delete({ where: { id } });
    return { ok: true };
  }

  // --- aanvullen via Claude ------------------------------------------------------------
  async aanvullen(aantal = 7, door = 'manueel') {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('Geen ANTHROPIC_API_KEY ingesteld op Render; de lijst kan niet automatisch aangevuld worden.');
    const n = Math.min(Math.max(Math.round(aantal) || 7, 1), 20);
    const bestaande = await this.prisma.spreuk.findMany({ select: { tekst: true }, orderBy: { createdAt: 'desc' }, take: 300 });
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const schema = {
      type: 'object', additionalProperties: false,
      properties: { spreuken: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { tekst: { type: 'string' }, auteur: { type: 'string' }, emoji: { type: 'string' } }, required: ['tekst', 'auteur', 'emoji'] } } },
      required: ['spreuken'],
    };
    const prompt =
      `Schrijf ${n} nieuwe korte spreuken (max. 110 tekens) in het Nederlands (Vlaamse toon mag) voor het startscherm van de kassa van "Marché", ` +
      'een buurtwinkel met verse voeding, wijn en een restaurant. Doel: het personeel vrolijk en gemotiveerd aan de dag laten beginnen. ' +
      'Mix van warm, grappig met een knipoog naar eten/winkel, en een enkel bekend citaat (dan met echte auteur; verzin geen citaten van echte personen). ' +
      'Eigen spreuken krijgen auteur "Marché". Geef per spreuk één passende emoji. Geen dubbels, geen clichés die hieronder al staan, geen religie of politiek.\n\n' +
      'Deze bestaan al (niet herhalen, ook niet in andere woorden):\n' + bestaande.map((b) => '- ' + b.tekst).join('\n') +
      '\n\nAntwoord uitsluitend met het JSON-object volgens het schema.';
    const params: any = { model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }], output_config: { format: { type: 'json_schema', schema } } };
    const resp: any = await client.messages.create(params);
    const tekst = (resp.content || []).find((b: any) => b.type === 'text')?.text ?? '';
    let data: { spreuken?: { tekst: string; auteur: string; emoji: string }[] } = {};
    try { data = JSON.parse(tekst); } catch { throw new BadRequestException('Claude gaf geen geldige lijst terug.'); }
    const nieuw = (data.spreuken ?? []).map((s) => ({ tekst: String(s.tekst ?? '').trim(), auteur: String(s.auteur ?? '').trim() || 'Marché', emoji: String(s.emoji ?? '').trim() || null, bron: 'AI' })).filter((s) => s.tekst.length >= 5 && s.tekst.length <= 160);
    const r = await this.prisma.spreuk.createMany({ data: nieuw, skipDuplicates: true });
    const verslag = { datum: this.brussel().datum, moment: new Date().toISOString(), door, toegevoegd: r.count, gevraagd: n };
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL }, create: { sleutel: SLEUTEL, waarde: JSON.stringify(verslag) }, update: { waarde: JSON.stringify(verslag) } });
    this.log.log(`Spreuken aangevuld (${door}): ${r.count} nieuwe.`);
    return { toegevoegd: r.count, spreuken: nieuw.slice(0, r.count) };
  }
}
