import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken, requireRole } from '../middleware/auth';

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
router.post('/', authenticateToken as any, requireRole(['COMPANY_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: 'Identifiant entreprise manquant.' });

  const { email, password, firstName, lastName, phone, role } = req.body;

  if (!email || !password || !firstName || !lastName || !role) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  if (!['TEAM_LEADER', 'WORKER', 'CLIENT'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
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

export default router;
