import { Injectable } from '@nestjs/common';

export type MollieBetaling = {
  id: string;
  status: string; // open | pending | authorized | paid | canceled | expired | failed
  mode: 'test' | 'live';
  amount: { currency: string; value: string };
  metadata?: { betalingId?: string } | null;
  _links?: { checkout?: { href: string } };
};
export type MollieTerugbetaling = { id: string; status: string };

const bedragVan = (euro: number) => ({ currency: 'EUR', value: euro.toFixed(2) });

// Betalingen van de webshop via Mollie: de klant betaalt op de beveiligde pagina van Mollie,
// wij krijgen enkel het resultaat. Instellen met MOLLIE_API_KEY op Render: test_... is de
// testmodus (geen echt geld, telt nergens mee), live_... zijn echte betalingen.
// Zonder sleutel kan er niet besteld worden: er wordt altijd vooraf digitaal betaald.
@Injectable()
export class MollieService {
  private sleutel() { return process.env.MOLLIE_API_KEY?.trim() || null; }

  geconfigureerd() { return !!this.sleutel(); }
  modus(): 'UIT' | 'TEST' | 'LIVE' {
    const s = this.sleutel();
    if (!s) return 'UIT';
    return s.startsWith('test_') ? 'TEST' : 'LIVE';
  }

  private async verzoek<T>(pad: string, body?: unknown, idempotentie?: string): Promise<T> {
    const sleutel = this.sleutel();
    if (!sleutel) throw new Error('Mollie is niet ingesteld (MOLLIE_API_KEY op Render).');
    const basis = (process.env.MOLLIE_API_URL?.trim() || 'https://api.mollie.com/v2').replace(/\/$/, '');
    const res = await fetch(`${basis}${pad}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${sleutel}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotentie ? { 'Idempotency-Key': idempotentie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000), // Mollie wacht maximaal 15 seconden op de webhook
    });
    const tekst = await res.text().catch(() => '');
    let data: (T & { detail?: string }) | null = null;
    try { data = JSON.parse(tekst); } catch { /* foutmelding hieronder */ }
    if (!res.ok || !data) throw new Error(`Mollie gaf HTTP ${res.status}${data?.detail ? `: ${data.detail}` : ''}`);
    return data;
  }

  maakBetaling(input: { bedrag: number; omschrijving: string; redirectUrl: string; webhookUrl: string; betalingId: string }) {
    return this.verzoek<MollieBetaling>('/payments', {
      amount: bedragVan(input.bedrag),
      description: input.omschrijving,
      redirectUrl: input.redirectUrl,
      webhookUrl: input.webhookUrl,
      locale: 'nl_BE',
      metadata: { betalingId: input.betalingId },
    });
  }

  haalBetaling(id: string) {
    return this.verzoek<MollieBetaling>(`/payments/${encodeURIComponent(id)}`);
  }

  // Dezelfde idempotentiesleutel vermijdt een dubbele terugbetaling als een verzoek herhaald wordt.
  terugbetalen(id: string, bedrag: number, omschrijving: string, idempotentie: string) {
    return this.verzoek<MollieTerugbetaling>(`/payments/${encodeURIComponent(id)}/refunds`, { amount: bedragVan(bedrag), description: omschrijving }, idempotentie);
  }

  async methoden() {
    const r = await this.verzoek<{ _embedded?: { methods?: { id: string; description: string }[] } }>('/methods');
    return r._embedded?.methods ?? [];
  }
}
