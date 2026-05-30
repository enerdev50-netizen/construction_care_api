import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';

const router = Router();

// Récupérer tout le stock de matériaux de l'entreprise (inclut l'indicateur d'alerte)
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;

  try {
    const materials = await prisma.material.findMany({
      where: { companyId: companyId! },
      orderBy: { name: 'asc' },
    });

    // Ajouter un attribut virtuel pour savoir s'il y a rupture
    const result = materials.map((m) => ({
      ...m,
      isLowStock: m.stock <= m.minStockAlert,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération du stock.' });
  }
});

// Ajouter un nouveau matériau en inventaire
router.post('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { name, minStockAlert, unit, initialStock } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Le nom du matériau est obligatoire.' });
  }

  try {
    const material = await prisma.material.create({
      data: {
        companyId: companyId!,
        name,
        minStockAlert: minStockAlert ? parseFloat(minStockAlert) : 5,
        unit: unit || 'sacs',
        stock: initialStock ? parseFloat(initialStock) : 0,
      },
    });

    res.status(201).json(material);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de l\'ajout du matériau.' });
  }
});

// Enregistrer un mouvement de stock (Entrée / Sortie)
router.post('/movement', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { materialId, projectId, type, quantity, reason } = req.body;

  if (!materialId || !type || !quantity) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  if (!['ENTREE', 'SORTIE'].includes(type)) {
    return res.status(400).json({ error: 'Type de mouvement invalide.' });
  }

  const qty = parseFloat(quantity);
  if (qty <= 0) {
    return res.status(400).json({ error: 'La quantité doit être supérieure à 0.' });
  }

  try {
    // Vérifier que le matériau appartient bien à l'entreprise
    const material = await prisma.material.findFirst({
      where: { id: materialId, companyId: companyId ?? undefined },
    });

    if (!material) {
      return res.status(404).json({ error: 'Matériau introuvable dans votre entreprise.' });
    }

    // Si c'est une sortie, vérifier si le stock est suffisant
    if (type === 'SORTIE' && material.stock < qty) {
      return res.status(400).json({
        error: `Stock insuffisant. Stock disponible: ${material.stock} ${material.unit}.`,
      });
    }

    // Enregistrer le mouvement et mettre à jour le stock dans une transaction
    const updatedMaterial = await prisma.$transaction(async (tx) => {
      // 1. Créer le mouvement
      await tx.materialMovement.create({
        data: {
          materialId,
          projectId: projectId || null,
          type,
          quantity: qty,
          reason,
        },
      });

      // 2. Mettre à jour le stock
      const stockAdjustment = type === 'ENTREE' ? qty : -qty;
      const updated = await tx.material.update({
        where: { id: materialId },
        data: {
          stock: {
            increment: stockAdjustment,
          },
        },
      });

      return updated;
    });

    res.json({
      message: 'Mouvement enregistré avec succès.',
      material: {
        ...updatedMaterial,
        isLowStock: updatedMaterial.stock <= updatedMaterial.minStockAlert,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du mouvement.' });
  }
});

// Récupérer la liste des alertes de rupture (stock <= seuil d'alerte)
router.get('/alerts', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;

  try {
    const lowStockMaterials = await prisma.material.findMany({
      where: {
        companyId: companyId!,
        stock: {
          lte: prisma.material.fields.minStockAlert, // SQL comparison where stock <= minStockAlert
        },
      },
    });

    res.json(lowStockMaterials);
  } catch (err) {
    // SQLite can sometimes have issues with direct field comparison in Prisma. Let's write fallback:
    try {
      const all = await prisma.material.findMany({ where: { companyId: companyId! } });
      const filtered = all.filter((m) => m.stock <= m.minStockAlert);
      res.json(filtered);
    } catch (innerErr) {
      res.status(500).json({ error: 'Erreur lors de la récupération des alertes de rupture.' });
    }
  }
});

export default router;
