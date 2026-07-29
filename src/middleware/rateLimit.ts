import rateLimit from 'express-rate-limit';

// En environnement de test, on désactive de fait le rate-limiting pour éviter les faux 429.
const isTest = process.env.NODE_ENV === 'test';

// Limiteur strict pour les routes sensibles d'authentification (login, OTP).
// Protège contre le brute-force ET la fraude SMS (chaque OTP a un coût réel AfrikSMS).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 100000 : 20, // 20 tentatives par IP et par fenêtre
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' },
});

// Limiteur global raisonnable pour l'ensemble de l'API.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTest ? 100000 : 300, // 300 requêtes par IP et par minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Veuillez ralentir.' },
});
