import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { flush } from "./observability/langfuse";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The Chrome extension calls the API from its own origin; the API key, not
  // the origin, is what authorises a request.
  app.enableCors({ origin: /^chrome-extension:\/\// });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Shortlyst listening on port ${port}`);

  // Uninstrumented exits silently drop whatever Langfuse hasn't flushed yet.
  const shutdown = async (signal: string) => {
    console.log(`${signal} received, flushing Langfuse before exit...`);
    await flush();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap();
