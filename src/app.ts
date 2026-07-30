import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import projectsRouter from './routes/projects';
import expensesRouter from './routes/expenses';
import materialsRouter from './routes/materials';
import documentsRouter from './routes/documents';
import progressRouter from './routes/progress';
import superadminRouter from './routes/superadmin';
import paymentsRouter from './routes/payments';
import { authLimiter, globalLimiter } from './middleware/rateLimit';

const app = express();

// Derrière un reverse proxy (hébergeur) : nécessaire pour que le rate-limiting voie la vraie IP client
app.set('trust proxy', 1);

// En-têtes de sécurité HTTP
app.use(helmet());

// CORS restreint : définir CORS_ORIGIN (liste séparée par des virgules) en production.
// `credentials: true` autorise l'envoi du cookie httpOnly de refresh.
// Sans CORS_ORIGIN, on reflète l'origine de la requête (origin: true) — jamais le wildcard `*`,
// qui est incompatible avec credentials.
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
);

// Parse les cookies (refresh token httpOnly)
app.use(cookieParser());

// Limiteur global anti-abus
app.use(globalLimiter);

// Augmenter la limite pour supporter le téléversement d'images Base64.
// `verify` conserve le corps BRUT sur `req.rawBody` : la vérification de signature
// du webhook FedaPay (HMAC sur le corps exact reçu) ne peut pas se fier au JSON
// re-sérialisé, qui ne byte-matche pas toujours l'original.
app.use(
  express.json({
    limit: '50mb',
    verify: (req: express.Request, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Endpoint racine de santé
app.get('/', (req, res) => {
  res.status(200).json({
    message: "Bienvenue sur l'API de Construction Care",
    version: '1.0.0',
    status: 'online',
  });
});

// Enregistrement des routes
app.use('/auth', authLimiter, authRouter);
app.use('/users', usersRouter);
app.use('/projects', projectsRouter);
app.use('/expenses', expensesRouter);
app.use('/materials', materialsRouter);
app.use('/documents', documentsRouter);
app.use('/progress', progressRouter);
app.use('/superadmin', superadminRouter);
app.use('/payments', paymentsRouter);

// 404 JSON pour toute route non trouvée (au lieu du HTML Express par défaut)
app.use((req, res) => {
  res.status(404).json({ error: 'Ressource introuvable.' });
});

// Gestionnaire d'erreurs global : renvoie du JSON et évite de fuiter la stack trace en production
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Une erreur interne est survenue.' });
});

export default app;
