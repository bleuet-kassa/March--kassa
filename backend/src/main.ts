import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // frontend (kassa/webshop) mag de API aanspreken

  // In productie (online server) serveert de backend óók de website. De API komt
  // dan onder /api te staan zodat ze niet botst met de website-routes. Lokaal
  // (ontwikkeling) verandert er niets: geen prefix, de Vite-proxy regelt /api.
  if (process.env.NODE_ENV === 'production') {
    app.setGlobalPrefix('api');
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Kassa-server draait op poort ${port}`);
}
bootstrap();
