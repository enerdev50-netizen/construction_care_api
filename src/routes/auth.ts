import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import axios from 'axios';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { uploadBase64ToS3 } from '../s3';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
} from '../auth/tokens';

const router = Router();

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
    console.log(`[OTP SMS LOG] Code de sécurité généré pour ${phone} : ${code}`);
    console.log(`==================================================\n`);

    // Envoi du SMS réel via AfrikSMS
    const smsUrl = process.env.AFRIK_SMS_URL || 'https://api.afriksms.com/api/web/web_v1/outbounds/send';
    const apiKey = process.env.AFRIK_SMS_API_KEY;
    const clientId = process.env.AFRIK_SMS_CLIENT_ID;
    const senderId = process.env.AFRIK_SMS_SENDER_ID || 'Ratoufa';

    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }
    formattedPhone = formattedPhone.replace(/\s+/g, '');

    const message = `Votre code de validation ConstructCare est : ${code}`;

    if (apiKey && clientId) {
      try {
        const smsResponse = await axios.get(smsUrl, {
          params: {
            api_id: clientId,
            api_key: apiKey,
            to: formattedPhone,
            msg: message,
            sender_id: senderId,
          }
        });
        console.log('AfrikSMS API Outbound Response:', smsResponse.data);
      } catch (smsErr) {
        console.error('Erreur lors de l\'appel à l\'API AfrikSMS:', smsErr);
      }
    } else {
      console.warn('AfrikSMS credentials non configurés dans le fichier .env - SMS réel sauté.');
    }

    res.json({
      message: 'Code envoyé avec succès par SMS.',
      code, // Renvoyé pour faciliter la validation dans l'interface si besoin
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
    const tokenPayload = {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      companyId: result.company.id,
    };
    const token = signAccessToken(tokenPayload);
    setRefreshCookie(res, signRefreshToken(tokenPayload));

    const planConfig = await prisma.subscriptionConfig.findUnique({
      where: { planName: result.company.subscriptionPlan },
    });

    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        phone: result.user.phone,
        role: result.user.role,
        companyId: result.user.companyId,
      },
      company: result.company,
      planConfig,
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
      return res.status(401).json({ error: 'Téléphone/Email ou mot de passe incorrect.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Téléphone/Email ou mot de passe incorrect.' });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    };
    const token = signAccessToken(tokenPayload);
    setRefreshCookie(res, signRefreshToken(tokenPayload));

    const planConfig = user.company
      ? await prisma.subscriptionConfig.findUnique({ where: { planName: user.company.subscriptionPlan } })
      : null;

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        companyId: user.companyId,
      },
      company: user.company,
      planConfig,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

// Renouveler l'access token à partir du refresh token (cookie httpOnly)
router.post('/refresh', async (req: AuthenticatedRequest, res: Response) => {
  const refreshToken = req.cookies?.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token manquant.' });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const payload = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
    };
    // Rotation du refresh token à chaque renouvellement
    setRefreshCookie(res, signRefreshToken(payload));
    return res.json({ token: signAccessToken(payload) });
  } catch (err) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Refresh token invalide ou expiré.' });
  }
});

// Déconnexion : invalide le cookie de refresh
router.post('/logout', (req: AuthenticatedRequest, res: Response) => {
  clearRefreshCookie(res);
  res.json({ message: 'Déconnexion réussie.' });
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

    const planConfig = user.company
      ? await prisma.subscriptionConfig.findUnique({ where: { planName: user.company.subscriptionPlan } })
      : null;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        companyId: user.companyId,
      },
      company: user.company,
      planConfig,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Récupérer toutes les configurations de plans (Public)
router.get('/plans', async (req, res) => {
  try {
    const plans = await prisma.subscriptionConfig.findMany({
      orderBy: { price: 'asc' },
    });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des configurations de plans.' });
  }
});

// Upgrade / Changement de plan d'abonnement (Simulation)
router.post('/subscription', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || req.user.role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'Seul l\'administrateur peut modifier l\'abonnement.' });
  }

  const { plan } = req.body;

  try {
    const planConfig = await prisma.subscriptionConfig.findUnique({
      where: { planName: plan },
    });

    if (!planConfig) {
      return res.status(400).json({ error: 'Plan d\'abonnement invalide.' });
    }

    const updatedCompany = await prisma.company.update({
      where: { id: req.user.companyId! },
      data: { subscriptionPlan: plan },
    });

    res.json({ message: 'Abonnement mis à jour avec succès.', company: updatedCompany, planConfig });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'abonnement.' });
  }
});

// Mettre à jour le profil de l'entreprise (Nom, Email, Téléphone, Adresse, Logo)
router.put('/company', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || req.user.role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'Seul l\'administrateur de l\'entreprise peut modifier le profil.' });
  }

  const { name, nif, email, phone, address, logoFile } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Le nom de l\'entreprise est obligatoire.' });
  }

  try {
    let finalLogoUrl = undefined;
    if (logoFile && logoFile.startsWith('data:')) {
      try {
        finalLogoUrl = await uploadBase64ToS3(logoFile, 'logos');
      } catch (s3Err) {
        console.warn('S3 upload error for logo, falling back to base64:', s3Err);
        finalLogoUrl = logoFile;
      }
    }

    const updatedCompany = await prisma.company.update({
      where: { id: req.user.companyId! },
      data: {
        name,
        nif: nif !== undefined ? nif : undefined,
        email: email !== undefined ? email : undefined,
        phone: phone !== undefined ? phone : undefined,
        address: address !== undefined ? address : undefined,
        logoUrl: finalLogoUrl !== undefined ? finalLogoUrl : undefined,
      },
    });

    res.json({ message: 'Profil de l\'entreprise mis à jour avec succès.', company: updatedCompany });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du profil de l\'entreprise.' });
  }
});

// Mettre à jour le profil de l'utilisateur connecté
router.put('/me', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });

  const userId = req.user.id;
  const { firstName, lastName, phone, email, password } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'Le prénom et le nom sont obligatoires.' });
  }

  try {
    const dataToUpdate: any = {
      firstName,
      lastName,
      phone: phone !== undefined ? phone : undefined,
      email: email !== undefined ? (email && email.trim() !== "" ? email.trim().toLowerCase() : null) : undefined,
    };

    if (password) {
      dataToUpdate.password = await bcrypt.hash(password, 10);
    }

    if (dataToUpdate.email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email: dataToUpdate.email,
          NOT: { id: userId },
        },
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Cette adresse email est déjà utilisée par un autre compte.' });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    res.json({ message: 'Profil mis à jour avec succès.', user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du profil.' });
  }
});

export default router;
