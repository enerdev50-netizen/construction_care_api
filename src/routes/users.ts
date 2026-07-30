import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken, requireRole } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { createUserSchema, updateUserSchema } from './users.schemas';

const router = Router();

// Récupérer la liste des utilisateurs de l'entreprise
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: 'Identifiant entreprise manquant.' });

  try {
    const users = await prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
  }
});

// Ajouter un utilisateur (ouvrier, chef d'équipe, ou client)
router.post('/', authenticateToken as any, requireRole(['COMPANY_ADMIN']) as any, validateBody(createUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: 'Identifiant entreprise manquant.' });

  const { email, password, firstName, lastName, phone, role } = req.body;
  const formattedEmail = email && email.trim() !== "" ? email.trim() : null;

  try {
    // Vérifier l'abonnement et la limite de collaborateurs
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      return res.status(404).json({ error: 'Entreprise introuvable.' });
    }

    const plan = company.subscriptionPlan;
    const config = await prisma.subscriptionConfig.findUnique({ where: { planName: plan } });
    const currentUserCount = await prisma.user.count({ where: { companyId } });

    if (config && currentUserCount >= config.maxUsers) {
      return res.status(403).json({
        error: `Limite de collaborateurs atteinte (Max ${config.maxUsers} pour le plan ${plan}). Veuillez passer au plan supérieur.`,
        limitReached: true,
      });
    }

    if (formattedEmail) {
      const existingUser = await prisma.user.findUnique({ where: { email: formattedEmail } });
      if (existingUser) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé.' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email: formattedEmail,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role,
        companyId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
      },
    });

    res.status(201).json(newUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'ajout de l\'utilisateur.' });
  }
});

// Supprimer un utilisateur
router.delete('/:id', authenticateToken as any, requireRole(['COMPANY_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.params.id;

  try {
    // Vérifier que l'utilisateur appartient à la même entreprise
    const userToDelete = await prisma.user.findFirst({
      where: { id: userId, companyId },
    });

    if (!userToDelete) {
      return res.status(404).json({ error: 'Utilisateur introuvable dans votre entreprise.' });
    }

    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'Utilisateur supprimé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur.' });
  }
});

// Modifier un utilisateur
router.put('/:id', authenticateToken as any, requireRole(['COMPANY_ADMIN']) as any, validateBody(updateUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.params.id;
  const { email, firstName, lastName, phone, role, password } = req.body;
  const formattedEmail = email !== undefined ? (email && email.trim() !== "" ? email.trim() : null) : undefined;

  try {
    const existingUser = await prisma.user.findFirst({
      where: { id: userId, companyId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const targetEmail = formattedEmail !== undefined ? formattedEmail : existingUser.email;
    const targetPhone = phone !== undefined ? phone : existingUser.phone;
    if (!targetEmail && !targetPhone) {
      return res.status(400).json({ error: 'L\'adresse email ou le numéro de téléphone est obligatoire.' });
    }

    if (formattedEmail && formattedEmail !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({ where: { email: formattedEmail } });
      if (emailExists) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé.' });
      }
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        email: formattedEmail !== undefined ? formattedEmail : undefined,
        firstName: firstName !== undefined ? firstName : undefined,
        lastName: lastName !== undefined ? lastName : undefined,
        phone: phone !== undefined ? phone : undefined,
        role: role !== undefined ? role : undefined,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur.' });
  }
});

export default router;
