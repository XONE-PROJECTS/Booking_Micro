import express, { type Express, type Request } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context';
import { identityMiddleware } from './http/identity';
import { errorHandler, notFoundHandler } from './http/errors';
import { registerRoutes } from './routes';

export function createHttpApp(appCtx: AppContext): Express {
  const app = express();
  app.set('trust proxy', appCtx.env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const origins = new Set(appCtx.env.CORS_ORIGINS);
  if (appCtx.env.NODE_ENV === 'development') {
    origins.add(appCtx.env.ADMIN_APP_URL);
    origins.add(appCtx.env.PORTAL_APP_URL);
  }
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origins.size === 0 || origins.has(origin)) cb(null, true);
        else cb(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    }),
  );

  app.use(cookieParser());
  app.use(
    express.json({
      limit: appCtx.env.REQUEST_BODY_LIMIT,
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );

  app.use(
    pinoHttp({
      logger: appCtx.log,
      genReqId: (req, res) => {
        const id = req.get('x-request-id') ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req) => ({ requestId: req.id, tenantId: req.ctx?.tenant?.id }),
    }),
  );

  app.get('/health', async (_req, res) => {
    const ok = await appCtx.db.ping();
    res.status(ok ? 200 : 503).json({ ok, service: 'universal-booking-api', time: new Date().toISOString() });
  });

  app.use(identityMiddleware(appCtx));

  app.use(
    rateLimit({
      windowMs: 60_000,
      max: appCtx.env.RATE_LIMIT_PER_MINUTE,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.ctx?.identity?.principalId ?? ipKeyGenerator(req.ip ?? '127.0.0.1'),
    }),
  );

  const api = express.Router();
  registerRoutes(appCtx, api);
  app.use(appCtx.env.API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}