/**
 * Amorçage de PRODUCTION — additif uniquement, idempotent.
 *
 * Crée le strict nécessaire au démarrage de la plateforme :
 *   - les 3 forfaits d'abonnement système (FREE, STANDARD, PREMIUM)
 *   - un compte SUPER_ADMIN
 *
 * Rien d'autre. Aucune donnée de démonstration, aucune suppression.
 *
 * Utilisé à la fois par le script `npm run seed:prod` et par l'amorçage au
 * démarrage du serveur (`src/bootstrap/index.ts`).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { SYSTEM_PLANS } from './systemPlans';

/** Le SUPER_ADMIN accède à toutes les entreprises : le mot de passe le plus faible acceptable reste long. */
export const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_ROUNDS = 10;

export class SeedConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedConfigurationError';
  }
}

export interface SuperAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

/** Journalisation injectable : silencieuse dans les tests, `console.log` par défaut. */
export type Logger = (message: string) => void;

/**
 * Lit et valide la configuration du Super Admin depuis l'environnement.
 * N'est appelée que si aucun SUPER_ADMIN n'existe : après le premier
 * déploiement, ces variables deviennent inutiles.
 */
export function readSuperAdminInput(env: NodeJS.ProcessEnv = process.env): SuperAdminInput {
  const errors: string[] = [];

  const email = env.SUPERADMIN_EMAIL?.trim() ?? '';
  const password = env.SUPERADMIN_PASSWORD ?? '';

  if (!email) {
    errors.push('SUPERADMIN_EMAIL est obligatoire.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(`SUPERADMIN_EMAIL n'est pas une adresse email valide : "${email}".`);
  }

  if (!password) {
    errors.push('SUPERADMIN_PASSWORD est obligatoire.');
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(
      `SUPERADMIN_PASSWORD doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères ` +
        `(reçu : ${password.length}).`
    );
  }

  if (errors.length > 0) {
    throw new SeedConfigurationError(
      `Aucun Super Administrateur n'existe et sa configuration est invalide :\n  - ${errors.join('\n  - ')}\n\n` +
        'Définissez ces variables dans le fichier .env de production ou dans ' +
        "l'environnement du déploiement. Elles ne doivent jamais être versionnées."
    );
  }

  return {
    email,
    password,
    firstName: env.SUPERADMIN_FIRSTNAME?.trim() || 'Super',
    lastName: env.SUPERADMIN_LASTNAME?.trim() || 'Administrateur',
    phone: env.SUPERADMIN_PHONE?.trim() || null,
  };
}

/**
 * Crée les forfaits manquants. Un forfait déjà présent est laissé INTACT :
 * une tarification ajustée en production ne doit pas être écrasée par un
 * redéploiement.
 */
export async function seedSystemPlans(prisma: PrismaClient, log: Logger): Promise<void> {
  let created = 0;
  let preserved = 0;

  for (const plan of SYSTEM_PLANS) {
    const existing = await prisma.subscriptionConfig.findUnique({
      where: { planName: plan.planName },
    });

    if (existing) {
      preserved++;
      continue;
    }

    // upsert plutôt que create : atomique côté SGBD, donc sûr même si deux
    // instances applicatives démarrent en parallèle.
    await prisma.subscriptionConfig.upsert({
      where: { planName: plan.planName },
      update: {},
      create: plan,
    });
    created++;
    log(`   + Forfait "${plan.planName}" créé (${plan.price} FCFA / ${plan.durationDays} j).`);
  }

  log(`✅ Forfaits : ${created} créé(s), ${preserved} déjà présent(s) et conservé(s).`);
}

/**
 * Crée le compte SUPER_ADMIN s'il n'en existe aucun.
 * Ne réécrit JAMAIS le mot de passe d'un compte existant.
 */
export async function seedSuperAdmin(
  prisma: PrismaClient,
  log: Logger,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { email: true },
  });

  if (existingSuperAdmin) {
    log(
      `✅ Super Administrateur : déjà présent (${existingSuperAdmin.email ?? 'sans email'}), aucune modification.`
    );
    return;
  }

  // Les variables ne sont exigées que sur une base sans Super Admin : après le
  // premier déploiement, l'application démarre sans elles.
  const input = readSuperAdminInput(env);

  const emailTaken = await prisma.user.findUnique({
    where: { email: input.email },
    select: { role: true },
  });

  if (emailTaken) {
    throw new SeedConfigurationError(
      `L'adresse "${input.email}" est déjà utilisée par un compte ${emailTaken.role}. ` +
        'Choisissez une autre adresse pour le Super Administrateur.'
    );
  }

  await prisma.user.create({
    data: {
      email: input.email,
      password: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: 'SUPER_ADMIN',
      // Le Super Admin n'appartient à aucune entreprise : il supervise la plateforme.
      companyId: null,
    },
  });

  // Le mot de passe n'est volontairement jamais affiché : la sortie de ce script
  // finit dans les journaux de déploiement.
  log(`✅ Super Administrateur créé : ${input.email}`);
}

/** Amorçage complet. Idempotent : peut être rejoué à chaque déploiement. */
export async function seedProduction(
  prisma: PrismaClient,
  log: Logger = console.log,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await seedSystemPlans(prisma, log);
  await seedSuperAdmin(prisma, log, env);
}
