import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encodeWeegBarcode } from '../common/weegbarcode';

@Injectable()
export class WeegService {
  constructor(private prisma: PrismaService) {}

  // Bouwt de etiketgegevens voor een gewogen artikel: prijs (= €/kg × gewicht),
  // een scanbare weeg-barcode en een ZPL-string voor de Zebra ZD421t.
  async etiket(productId: string, gewicht: number) {
    if (!(gewicht > 0)) throw new BadRequestException('Geef een geldig gewicht (kg).');
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product niet gevonden.');

    // Zorg dat het product een weegnummer heeft (voor de barcode).
    let weegNummer = product.weegNummer;
    if (weegNummer == null) weegNummer = await this.nieuwWeegNummer(productId);

    const eenheidsprijs = Number(product.verkoopprijs); // €/kg (consumentenprijs incl. BTW)
    const gram = Math.round(gewicht * 1000);
    const prijs = Math.round(eenheidsprijs * gewicht * 100) / 100;
    const barcode = encodeWeegBarcode(weegNummer, gram);

    return {
      productId: product.id,
      naam: product.naam,
      weegNummer,
      eenheidsprijs,
      gewicht: Math.round(gewicht * 1000) / 1000,
      gram,
      prijs,
      barcode,
      zpl: this.bouwZpl(product.naam, eenheidsprijs, gewicht, prijs, barcode),
    };
  }

  // Volgend vrij weegnummer (1..9999), atomisch toegewezen aan het product.
  private async nieuwWeegNummer(productId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const hoogste = await tx.product.aggregate({ _max: { weegNummer: true } });
      const volgend = (hoogste._max.weegNummer ?? 0) + 1;
      if (volgend > 9999) throw new BadRequestException('Maximum aantal weegnummers bereikt.');
      await tx.product.update({ where: { id: productId }, data: { weegNummer: volgend } });
      return volgend;
    });
  }

  // Minimale ZPL voor een ~50×30 mm etiket (203 dpi). De Zebra rendert de EAN-13
  // zelf uit de eerste 12 cijfers (voegt het controlecijfer toe).
  private bouwZpl(naam: string, eenheidsprijs: number, gewicht: number, prijs: number, barcode: string): string {
    const veilig = (s: string) => s.replace(/[\^~]/g, ' ');
    return [
      '^XA',
      '^CI28',
      `^FO20,20^A0N,30,30^FD${veilig(naam).slice(0, 28)}^FS`,
      `^FO20,60^A0N,24,24^FD${gewicht.toFixed(3)} kg  x  EUR ${eenheidsprijs.toFixed(2)}/kg^FS`,
      `^FO20,92^A0N,40,40^FDEUR ${prijs.toFixed(2)}^FS`,
      `^FO40,150^BEN,90,Y,N^FD${barcode.slice(0, 12)}^FS`,
      '^XZ',
    ].join('\n');
  }
}
