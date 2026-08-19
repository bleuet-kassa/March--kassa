import { Body, Controller, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { ProductsService, ProductInput } from './products.service';

@Controller('producten')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // GET /producten?zoek=...  -> lijst (met zoekterm)
  @Get()
  findAll(@Query('zoek') zoek?: string) {
    return this.products.findAll(zoek);
  }

  // Specifieke routes VÓÓR de :id-route, anders vangt :id ze op.
  @Get('nieuwe-barcode')
  nieuweBarcode() {
    return this.products.nieuweBarcode().then((barcode) => ({ barcode }));
  }

  // GET /producten/speciaal -> "diversen"/vrij-bedrag-knoppen voor de kassa
  @Get('speciaal')
  speciaal() {
    return this.products.speciaal();
  }

  // GET /producten/barcode/5410228123456  -> product voor de kassa
  @Get('barcode/:barcode')
  findByBarcode(@Param('barcode') barcode: string) {
    return this.products.findByBarcode(barcode);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  // POST /producten  -> nieuw product aanmaken
  @Post()
  create(@Body() body: ProductInput) {
    return this.products.create(body);
  }

  // PATCH /producten/:id  -> product bewerken
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ProductInput) {
    return this.products.update(id, body);
  }

  // PATCH /producten/:id/webshop  -> snel in/uit de webshop zetten
  @Patch(':id/webshop')
  setWebshop(@Param('id') id: string, @Body() body: { zichtbaar: boolean }) {
    return this.products.setWebshop(id, body.zichtbaar);
  }
}
