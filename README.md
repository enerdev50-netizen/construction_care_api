# Construction Care API

L'API de **Construction Care** est le service backend REST développé en Node.js, Express, TypeScript et Prisma. Elle gère la logique métier d'une plateforme SaaS multi-locataires (multi-tenant) pour le suivi des chantiers de construction, l'inventaire des matériaux, la gestion des dépenses, les rapports de photos quotidiennes et la signature de devis/factures.

Pour protéger les données existantes de l'application de pharmacie, toutes les tables de ce projet sont isolées dans le schéma PostgreSQL dédié **`construction`** sur Supabase.

---

## 🚀 Fonctionnalités principales

1. **Authentification & Gestion Multi-Tenant :** Inscription d'entreprise (2 phases) et connexion par **Numéro de téléphone + Mot de passe**.
2. **Gestion d'Abonnement (Tiers) :** Restriction des fonctionnalités (ex: création limitée de chantiers) selon le forfait choisi (`FREE`, `STANDARD`, `PREMIUM`).
3. **Suivi des Chantiers & Tâches :** Création, affectation de personnel (chefs d'équipe, ouvriers, clients) et avancement des tâches phares (Fondations, Élévation, Toiture, etc.).
4. **Comptabilité & Dépenses :** Saisie des dépenses par catégorie (ciment, sable, transport, main d'œuvre) et agrégations financières pour les tableaux de bord.
5. **Inventaire & Alerte Rupture :** Mouvements de stock (entrées/sorties) de matériaux avec détection automatique et alerte en cas de niveau inférieur au seuil critique.
6. **Rapports Quotidiens :** Téléversement de photos de chantier (codées en Base64) pour le suivi visuel chronologique.
7. **Gestion Documentaire :** Génération virtuelle de devis/factures avec module de signature électronique sur canvas.

---

## 🛠️ Pile Technologique

* **Runtime :** Node.js
* **Langage :** TypeScript (compilation via `tsc`, exécution de développement via `ts-node`)
* **Framework Web :** Express.js
* **ORM :** Prisma
* **Base de données :** PostgreSQL (hébergé sur Supabase, schéma isolé `construction`)
* **Sécurité :** Hachage des mots de passe avec `bcrypt`, authentification par jeton JWT

---

## 📂 Structure du Projet

```
construction_care_api/
├── prisma/
│   ├── schema.prisma   # Schéma Prisma configuré pour le schéma "construction"
│   └── seed.ts         # Script d'alimentation des données de démo
├── src/
│   ├── app.ts          # Initialisation et middlewares Express
│   ├── index.ts        # Point d'entrée du serveur (Port 3001)
│   ├── prisma.ts       # Client Prisma partagé
│   └── routes/         # Endpoints de l'API REST
│       ├── auth.ts      # Authentification, Inscription & Tiers
│       ├── documents.ts # Devis, Factures & Signatures
│       ├── expenses.ts  # Journal des dépenses & statistiques
│       ├── materials.ts # Gestion des matériaux & mouvements de stock
│       ├── progress.ts  # Journalisation des photos de suivi
│       ├── projects.ts  # Gestion des chantiers & affectations
│       └── users.ts     # Gestion des collaborateurs & clients
├── .env                # Variables d'environnement locales
├── .gitignore          # Fichiers ignorés par Git
├── package.json        # Dépendances et scripts de démarrage
└── tsconfig.json       # Configuration TypeScript
```

---

## ⚙️ Configuration Locale

### 1. Variables d'environnement
Créez ou modifiez le fichier `.env` à la racine du dossier `construction_care_api` :

```env
PORT=3001
DATABASE_URL="postgresql://<username>:<password>@<host>:<port>/postgres?schema=construction"
DIRECT_URL="postgresql://<username>:<password>@<host>:<port>/postgres?schema=construction"
JWT_SECRET="votre_cle_secrete_jwt"
```

### 2. Installation des dépendances
```bash
npm install
```

### 3. Synchronisation de la base de données
Poussez le schéma Prisma vers le schéma isolé de Supabase et générez le client Prisma :
```bash
npx prisma generate
npx prisma db push
```

### 4. Peuplement des données de démonstration (Seed)
Exécutez le script d'alimentation pour ajouter des chantiers, matériaux et les utilisateurs de démo :
```bash
npx prisma db seed
```

---

## 🏃 Scripts de Démarrage

* **Démarrage en mode développement (Rechargement à chaud) :**
  ```bash
  npm run dev
  ```
* **Compilation du projet :**
  ```bash
  npm run build
  ```
* **Lancement en production (après build) :**
  ```bash
  npm run start
  ```

---

## 📌 Comptes de test pré-configurés (Seeded Accounts)

Tous les mots de passe de test sont définis sur **`password123`**.

| Rôle | Téléphone de connexion |
| :--- | :--- |
| **Administrateur / Gérant** | `+228 90 12 34 56` (ou saisie abrégée `90123456`) |
| **Chef de Chantier** | `+228 91 23 45 67` (ou `91234567`) |
| **Ouvrier de terrain** | `+228 92 34 56 78` (ou `92345678`) |
| **Client Propriétaire** | `+228 93 45 67 89` (ou `93456789`) |
