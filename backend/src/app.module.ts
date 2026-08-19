import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthGuard } from './auth/auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { StockModule } from './stock/stock.module';
import { SalesModule } from './sales/sales.module';
import { AuthModule } from './auth/auth.module';
import { DagafsluitingModule } from './reports/dagafsluiting.module';
import { MetaModule } from './meta/meta.module';
import { FacturenModule } from './facturen/facturen.module';
import { ScradaModule } from './scrada/scrada.module';
import { CadeaubonnenModule } from './cadeaubonnen/cadeaubonnen.module';
import { KortingenModule } from './kortingen/kortingen.module';
import { WebshopModule } from './webshop/webshop.module';
import { WeegModule } from './weeg/weeg.module';
import { SiteModule } from './site/site.module';
import { RekeningenModule } from './rekeningen/rekeningen.module';

// In productie serveert de backend de gebouwde website (Vite build in /public),
// met een SPA-fallback naar index.html. De API-routes (/api/...) worden
// uitgesloten zodat ze gewoon de controllers bereiken. Lokaal (ontwikkeling)
// wordt dit niet geladen — daar serveert de Vite-dev-server de website.
const staticImports =
  process.env.NODE_ENV === 'production'
    ? [
        ServeStaticModule.forRoot({
          // __dirname is dist/src bij de gebouwde backend -> twee niveaus omhoog
          // naar de backend-map, waar de gebouwde website in /public staat.
          rootPath: process.env.FRONTEND_DIR || join(__dirname, '..', '..', 'public'),
          exclude: ['/api/(.*)'],
        }),
      ]
    : [];

@Module({
  imports: [
    ...staticImports,
    PrismaModule,
    ProductsModule,
    StockModule,
    SalesModule,
    AuthModule,
    DagafsluitingModule,
    MetaModule,
    FacturenModule,
    ScradaModule,
    CadeaubonnenModule,
    KortingenModule,
    WebshopModule,
    WeegModule,
    SiteModule,
    RekeningenModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
