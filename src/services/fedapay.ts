/**
 * Service d'encaissement Mobile Money via FedaPay — intégration directe (white label).
 *
 * Adapté du service `FedaPayService` (Ratoufa Pay) fourni comme modèle par le PM.
 * Différences assumées, propres à ConstructCare :
 *
 *   - `include_fees: false` : valeur par défaut du modèle fourni, conservée.
 *     ⚠️ TESTÉ EN SANDBOX RÉEL le 2026-07-30 (compte sandbox fourni par le PM,
 *     mode `momo_test`) : la valeur de `include_fees` (true OU false) n'a AUCUN
 *     effet observable sur ce compte. Dans les deux cas, pour une transaction de
 *     1000 FCFA : `amount_transferred` (reçu par la plateforme) = 1000 FCFA
 *     (montant plein, jamais amputé) et `amount_debited` (débité du portefeuille
 *     Mobile Money du client) = 1042 FCFA (+4,2 %, `fees: 42`). Autrement dit :
 *     la plateforme reçoit toujours l'intégralité du montant facturé, et le
 *     surcoût de 4,2 % semble être un frais réseau Mobile Money/FedaPay
 *     systématiquement répercuté sur le payeur, indépendant de ce flag.
 *     C'est un POINT OUVERT (voir PRD, Docs/TODO.md) : à confirmer avec le
 *     support FedaPay avant la mise en production — le comportement sur un
 *     compte live avec de vrais opérateurs (Mixx by Togocel, Moov Togo) peut
 *     différer du mode sandbox `momo_test` générique testé ici.
 *   - pas de `callback_url` : aucune redirection, le webhook signé fait foi
 *     (voir `routes/payments.ts` et `verifyWebhookSignature` ci-dessous).
 *   - initialisation paresseuse : l'API démarre sans clé FedaPay configurée ;
 *     les routes de paiement répondent alors 503 plutôt que de planter au boot.
 */
import { FedaPay, Transaction } from 'fedapay';
import crypto from 'crypto';

/** Opérateurs Mobile Money supportés. Le Togo est la priorité produit ; le reste suit la table FedaPay. */
export const MOBILE_MONEY_PROVIDERS = [
  'togocel', 'moov_tg',
  'mtn_bj', 'moov_bj',
  'mtn_ci', 'moov_ci',
  'orange_sn',
] as const;

export type MobileMoneyProvider = (typeof MOBILE_MONEY_PROVIDERS)[number];

export function isMobileMoneyProvider(value: unknown): value is MobileMoneyProvider {
  return typeof value === 'string' && (MOBILE_MONEY_PROVIDERS as readonly string[]).includes(value);
}

const COUNTRY_BY_PROVIDER: Record<MobileMoneyProvider, string> = {
  togocel: 'TG', moov_tg: 'TG',
  mtn_bj: 'BJ', moov_bj: 'BJ',
  mtn_ci: 'CI', moov_ci: 'CI',
  orange_sn: 'SN',
};

const METHOD_BY_PROVIDER: Record<MobileMoneyProvider, string> = {
  togocel: 'togocel', moov_tg: 'moov_tg',
  mtn_bj: 'mtn', moov_bj: 'moov',
  mtn_ci: 'mtn_ci', moov_ci: 'moov_ci',
  orange_sn: 'orange_sn',
};

/** Fenêtre de tolérance sur l'horodatage de signature du webhook (anti-rejeu). */
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

let sdkConfigured = false;

/** Permet aux routes de répondre 503 proprement plutôt que de planter au démarrage. */
export function isFedaPayConfigured(): boolean {
  return !!process.env.FEDAPAY_SECRET_KEY;
}

/** Initialise le SDK au premier usage réel (pas au chargement du module). */
function ensureConfigured(): void {
  if (sdkConfigured) return;
  if (!isFedaPayConfigured()) {
    throw new Error("FedaPay n'est pas configuré (FEDAPAY_SECRET_KEY manquant).");
  }
  FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY!);
  FedaPay.setEnvironment(process.env.FEDAPAY_ENVIRONMENT || 'sandbox');
  sdkConfigured = true;
}

function isSandbox(): boolean {
  return (process.env.FEDAPAY_ENVIRONMENT || 'sandbox') === 'sandbox';
}

/**
 * Formate un numéro pour FedaPay : numéro local uniquement (8 chiffres), le
 * pays est transmis séparément. Un indicatif dans `phone_number.number` est
 * rejeté par FedaPay (400) — mêmes règles que le modèle fourni.
 */
export function formatPhoneNumber(rawNumber: string): string {
  let cleaned = rawNumber.replace(/\D/g, '');
  const countryPrefixes = ['229', '228', '237', '225', '221', '226', '227'];
  for (const prefix of countryPrefixes) {
    if (cleaned.startsWith(prefix) && cleaned.length > 8) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }
  return cleaned.slice(-8);
}

/**
 * En sandbox, FedaPay n'approuve automatiquement que les numéros de test béninois
 * (66000001, 64000001) sous la méthode unifiée `momo_test` : on force donc BJ /
 * momo_test hors production, comme dans le modèle fourni.
 */
export function getCountryFromProvider(provider: MobileMoneyProvider): string {
  return isSandbox() ? 'BJ' : COUNTRY_BY_PROVIDER[provider];
}

export function getOperatorMethod(provider: MobileMoneyProvider): string {
  return isSandbox() ? 'momo_test' : METHOD_BY_PROVIDER[provider];
}

export interface CreateTransactionInput {
  amount: number; // FCFA, entier strict
  description: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  provider: MobileMoneyProvider;
}

/**
 * Crée la transaction FedaPay. La plateforme reçoit toujours le montant plein
 * (`amount_transferred == amount`, vérifié en sandbox) ; voir l'en-tête du
 * fichier pour le point ouvert sur le surcoût observé côté payeur.
 */
export async function createTransaction(data: CreateTransactionInput) {
  ensureConfigured();

  const nameParts = data.customerName.trim().split(/\s+/).filter(Boolean);
  const firstname = nameParts[0] || 'Client';
  const lastname = nameParts.slice(1).join(' ') || 'ConstructCare';

  try {
    return await Transaction.create({
      amount: Math.round(data.amount),
      description: data.description,
      currency: { iso: 'XOF' },
      // Valeur par défaut du modèle Ratoufa Pay. Sans effet observable sur le
      // compte sandbox testé (voir en-tête du fichier) — conservée en l'état.
      include_fees: false,
      customer: {
        firstname,
        lastname,
        email: data.customerEmail || `client_${Date.now()}@constructcare.app`,
        phone_number: {
          number: formatPhoneNumber(data.customerPhone),
          country: getCountryFromProvider(data.provider),
        },
      },
    } as any);
  } catch (error: any) {
    throw new Error(`Erreur FedaPay (création) : ${extractFedaPayMessage(error)}`);
  }
}

/** Déclenche le push USSD sur le téléphone du payeur — aucune redirection. */
export async function triggerDirectPayment(fedapayTransactionId: number, provider: MobileMoneyProvider) {
  ensureConfigured();
  const method = getOperatorMethod(provider);

  try {
    const transaction: any = await Transaction.retrieve(fedapayTransactionId);
    const tokenObject = await transaction.generateToken();
    return await transaction.sendNowWithToken(method, tokenObject.token);
  } catch (error: any) {
    throw new Error(`Erreur FedaPay (push USSD, ${method}) : ${extractFedaPayMessage(error)}`);
  }
}

export async function getTransactionStatus(fedapayTransactionId: number) {
  ensureConfigured();
  try {
    return await Transaction.retrieve(fedapayTransactionId);
  } catch (error: any) {
    throw new Error(`Impossible de récupérer la transaction FedaPay : ${extractFedaPayMessage(error)}`);
  }
}

function extractFedaPayMessage(error: any): string {
  const fedaResponse = error?.response?.data;
  const msg = fedaResponse?.message || fedaResponse?.errors || error?.message || 'Erreur inconnue';
  return typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
}

/**
 * Vérifie la signature du webhook FedaPay sur le CORPS BRUT (schéma type Stripe :
 * `x-fedapay-signature: t=<timestamp>,s=<hex>`, s = HMAC-SHA256(secret, "<t>.<corps>")).
 *
 * Comparaison en temps constant + tolérance d'horodatage anti-rejeu. Ne lève jamais :
 * renvoie `false` sur toute anomalie, la route webhook décide de la réponse HTTP.
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env.FEDAPAY_WEBHOOK_KEY;
  if (!secret || !signatureHeader) return false;

  const parts: Record<string, string> = {};
  for (const kv of signatureHeader.split(',')) {
    const [key, value] = kv.split('=');
    if (key && value) parts[key] = value;
  }
  const timestamp = parts.t;
  const signature = parts.s;
  if (!timestamp || !signature) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) return false;

  let expectedBuf: Buffer;
  let receivedBuf: Buffer;
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    expectedBuf = Buffer.from(expected, 'hex');
    receivedBuf = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}
