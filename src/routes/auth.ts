import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'construction_care_secret_key_12345!';

// Envoi du code OTP pour validation du téléphone (Phase 3)
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Numéro de téléphone requis.' });
  }

  // Code OTP à 6 chiffres
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes d'expiration

  try {
    await prisma.oTPVerification.upsert({
      where: { phone },
      update: { code, expiresAt },
      create: { phone, code, expiresAt },
    });

    console.log(`\n==================================================`);
    console.log(`[OTP SMS SIMULATION] Code de sécurité pour ${phone} : ${code}`);
    console.log(`==================================================\n`);

    res.json({
      message: 'Code envoyé avec succès par SMS (simulation).',
      code, // Renvoyé pour faciliter la validation locale dans l'interface de test
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération de l\'OTP.' });
  }
});

// Inscription de l'entreprise et du gérant (Admin) après vérification OTP (Phase 1, 2, 3)
router.post('/register', async (req, res) => {
  const {
    companyName,
    companyEmail,
    companyPhone,
    companyAddress,
    firstName,
    lastName,
    email,
    password,
    otpCode,
  } = req.body;

  // Validation Phase 1 & Phase 2 (otpCode is optional now)
  if (!companyName || !companyPhone || !firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  try {
    if (otpCode) {
      // Phase 3 : Vérification du numéro de téléphone par OTP
      const verification = await prisma.oTPVerification.findUnique({
        where: { phone: companyPhone },
      });

      if (!verification) {
        return res.status(400).json({ error: 'Aucun code OTP généré pour ce numéro.' });
      }

      if (verification.code !== otpCode) {
        return res.status(400).json({ error: 'Code de validation OTP incorrect.' });
      }

      if (verification.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Code de validation OTP expiré.' });
      }
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé par un gérant.' });
    }

    // Hashage du mot de passe avec bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // Création de l'entreprise et de l'utilisateur dans une transaction
    const result = await prisma.$transaction(async (tx) => {
      if (otpCode) {
        // Nettoyer le code OTP
        await tx.oTPVerification.delete({
          where: { phone: companyPhone },
        }).catch(() => {});
      }

      const company = await tx.company.create({
        data: {
          name: companyName,
          email: companyEmail,
          phone: companyPhone,
          address: companyAddress,
          subscriptionPlan: 'FREE', // Par défaut plan gratuit
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone: companyPhone,
          role: 'COMPANY_ADMIN',
          companyId: company.id,
        },
      });

      return { company, user };
    });

    // Génération du token JWT
    const token = jwt.sign(
      {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        companyId: result.company.id,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
      company: result.company,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

// Connexion d'un utilisateur (par téléphone ou email + mot de passe)
router.post('/login', async (req, res) => {
  const { phone, email, password } = req.body;
  const loginIdentifier = phone || email;

  if (!loginIdentifier || !password) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  try {
    // 1. Tenter un matching direct (exact)
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: loginIdentifier },
          { email: loginIdentifier }
        ]
      },
      include: { company: true },
    });

    // 2. Si échec, tenter un matching flexible en nettoyant les caractères non-numériques (ex: 90123456 vs +228 90 12 34 56)
    if (!user) {
      const inputDigits = loginIdentifier.replace(/\D/g, '');
      if (inputDigits.length >= 6) {
        const allUsers = await prisma.user.findMany({
          where: { phone: { not: null } },
          include: { company: true }
        });
        
        user = allUsers.find(u => {
          const dbDigits = u.phone!.replace(/\D/g, '');
          return dbDigits.endsWith(inputDigits) || inputDigits.endsWith(dbDigits);
        }) || null;
      }
    }

    if (!user) {
      return res.status(400).json({ error: 'Téléphone/Email ou mot de passe incorrect.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Téléphone/Email ou mot de passe incorrect.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
      },
      company: user.company,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

// Récupérer les informations de la session courante
router.get('/me', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { company: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
      },
      company: user.company,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Upgrade / Changement de plan d'abonnement (Simulation)
router.post('/subscription', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || req.user.role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'Seul l\'administrateur peut modifier l\'abonnement.' });
  }

  const { plan } = req.body; // "FREE", "STANDARD", "PREMIUM"
  if (!['FREE', 'STANDARD', 'PREMIUM'].includes(plan)) {
    return res.status(400).json({ error: 'Plan d\'abonnement invalide.' });
  }

  try {
    const updatedCompany = await prisma.company.update({
      where: { id: req.user.companyId! },
      data: { subscriptionPlan: plan },
    });

    res.json({ message: 'Abonnement mis à jour avec succès.', company: updatedCompany });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'abonnement.' });
  }
});

export default router;
