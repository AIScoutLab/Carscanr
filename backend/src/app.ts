import cors from "cors";
import express from "express";
import { env, getStartupDiagnostics } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { providers } from "./lib/providerRegistry.js";
import { isUsingMockRepositories } from "./lib/repositoryRegistry.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { buildApiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.use(requestContextMiddleware);
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          requestId: res.locals.requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        "HTTP request",
      );
    });
    next();
  });
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    const diagnostics = getStartupDiagnostics();
    res.json({
      success: true,
      data: {
        status: "ok",
        environment: env.NODE_ENV,
        appEnv: env.APP_ENV,
        diagnostics: {
          ...diagnostics,
          usingMockRepositories: isUsingMockRepositories(),
          activeProviders: {
            vision: diagnostics.visionProvider,
            specs: providers.specsProviderName,
            value: providers.valueProviderName,
            listings: providers.listingsProviderName,
          },
        },
      },
      requestId: res.locals.requestId,
    });
  });

  app.use("/api", buildApiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
