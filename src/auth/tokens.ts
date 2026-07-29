import jwt, { SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';
import { JWT_SECRET } from '../config';

// Secret distinct pour les refresh tokens (dérivé du JWT_SECRET si non fourni)
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}::refresh`;

// Durées de vie : access court (limite l'exposition en cas de vol), refresh long
const ACCESS_TTL = (process.env.ACCESS_TOKEN_TTL || '12h') as SignOptions['expiresIn'];
const REFRESH_TTL_DAYS = 7;
const REFRESH_TTL = `${REFRESH_TTL_DAYS}d` as SignOptions['expiresIn'];

const isProd = process.env.NODE_ENV === 'production';
export const REFRESH_COOKIE = 'refresh_token';

export interface TokenPayload {
  id: string;
  email: string | null;
  role: string;
  companyId: string | null;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as TokenPayload;
}

// Options du cookie httpOnly du refresh token.
// En prod (HTTPS) : SameSite=None + Secure pour autoriser le cross-origin.
// En dev (HTTP) : SameSite=Lax (fonctionne en same-origin ; l'app reste utilisable via l'access token en en-tête).
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/auth',
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}
