# Construction Care API

L'API de **Construction Care** est le service backend REST développé en Node.js, Express, TypeScript et Prisma. Elle gère la logique métier d'une plateforme SaaS multi-locataires (multi-tenant) pour le suivi des chantiers de construction, l'inventaire des matériaux, la gestion des dépenses, les rapports de photos quotidiennes et la signature de devis/factures.

La base de données est **MySQL 8.4**. L'isolation entre entreprises (multi-tenant) est assurée exclusivement par la couche applicative : chaque requête est filtrée par le `companyId` porté par le JWT.

---

## 🚀 Fonctionnalités principales

1. **Authentification & Gestion Multi-Tenant :** Inscription d'entreprise (2 phases) et connexion par **Email ou Numéro de téléphone + Mot de passe**. Access token JWT (12 h) + refresh token en cookie `httpOnly` (7 j).
2. **Gestion d'Abonnement (Tiers) :** Restriction des fonctionnalités (ex : création limitée de chantiers) selon le forfait choisi (`FREE`, `STANDARD`, `PREMIUM`).
3. **Suivi des Chantiers & Tâches :** Création, affectation de personnel (chefs d'équipe, ouvriers, clients) et avancement des tâches phares (Fondations, Élévation, Toiture, etc.).
4. **Comptabilité & Dépenses :** Saisie des dépenses par catégorie (ciment, sable, transport, main d'œuvre) et agrégations financières pour les tableaux de bord.
5. **Inventaire & Alerte Rupture :** Mouvements de stock (entrées/sorties) de matériaux avec détection automatique et alerte en cas de niveau inférieur au seuil critique.
6. **Rapports Quotidiens :** Téléversement de photos de chantier (envoi S3, repli Base64) pour le suivi visuel chronologique.
7. **Gestion Documentaire :** Génération de devis/factures avec module de signature électronique sur canvas.

---

## 🛠️ Pile Technologique

* **Runtime :** Node.js
* **Langage :** TypeScript (compilation via `tsc`, exécution de développement via `ts-node`)
* **Framework Web :** Express.js
* **ORM :** Prisma 6 (migrations versionnées)
* **Base de données :** MySQL 8.4 (`utf8mb4` / `utf8mb4_unicode_ci`, moteur InnoDB)
* **Stockage fichiers :** S3-compatible (Hetzner Object Storage)
* **Tests :** Vitest + Supertest
* **Sécurité :** `bcrypt`, JWT, `helmet`, rate-limiting, CORS restreint

---

## 📂 Structure du Projet

```
construction_care_api/
├── prisma/
│   ├── migrations/     # Migrations SQL versionnées (source de vérité du schéma)
│   ├── schema.prisma   # Modèle de données Prisma (provider mysql)
│   └── seed.ts         # Script d'alimentation des données de démo
├── scripts/
│   └── verify-tenant-isolation.ts  # Vérification bout-en-bout de l'isolation multi-tenant
├── src/
│   ├── app.ts          # Initialisation et middlewares Express
│   ├── index.ts        # Point d'entrée du serveur
│   ├── config.ts       # Chargement/validation des variables sensibles (fail-fast)
│   ├── prisma.ts       # Client Prisma partagé
│   ├── db_check.ts     # Diagnostic : liste les tables de la base courante
│   ├── s3.ts           # Client de stockage objet
│   ├── auth/           # Génération et vérification des jetons
│   ├── middleware/     # Authentification, rate-limiting
│   └── routes/         # Endpoints de l'API REST
├── tests/              # Suite Vitest (auth, isolation multi-tenant, colonnes MySQL)
├── .env                # Variables d'environnement locales (NON versionné)
├── .env.test           # Variables de la base de test (NON versionné)
├── .env.example        # Modèle à copier
└── package.json
```

---

## ⚙️ Installation locale (de zéro)

### 1. Prérequis logiciels

| Composant | Version installée | Emplacement (Windows) |
| :--- | :--- | :--- |
| Node.js | ≥ 18 | — |
| **MySQL Community Server** | **8.4.9** | `C:\Program Files\MySQL\MySQL Server 8.4` |
| Données MySQL (`datadir`) | — | `C:\ProgramData\MySQL\MySQL Server 8.4\Data` |
| Configuration MySQL | — | `C:\ProgramData\MySQL\MySQL Server 8.4\my.ini` |

MySQL écoute sur le **port 3306**, avec `character_set_server = utf8mb4` et `collation_server = utf8mb4_unicode_ci`.

> **⚠️ Le service Windows MySQL n'est pas enregistré sur ce poste.** Le serveur ne démarre donc pas
> automatiquement au boot. Deux options :
>
> * **Recommandé — enregistrer le service** (nécessite une invite **Administrateur**, à faire une fois) :
>   ```powershell
>   & "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --install MySQL84 --defaults-file="C:\ProgramData\MySQL\MySQL Server 8.4\my.ini"
>   Start-Service MySQL84
>   Set-Service MySQL84 -StartupType Automatic
>   ```
> * **Dépannage — démarrage manuel** (le serveur s'arrête à la fermeture du terminal) :
>   ```powershell
>   & "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file="C:\ProgramData\MySQL\MySQL Server 8.4\my.ini" --console
>   ```

### 2. Création des bases et de l'utilisateur applicatif

À exécuter **une seule fois**, connecté en `root` :

```sql
CREATE DATABASE IF NOT EXISTS `constructcare_dev`    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `constructcare_test`   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `constructcare_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'constructcare'@'localhost' IDENTIFIED BY '<mot_de_passe>';
CREATE USER IF NOT EXISTS 'constructcare'@'127.0.0.1' IDENTIFIED BY '<mot_de_passe>';

GRANT ALL PRIVILEGES ON `constructcare_dev`.*    TO 'constructcare'@'localhost', 'constructcare'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `constructcare_test`.*   TO 'constructcare'@'localhost', 'constructcare'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `constructcare_shadow`.* TO 'constructcare'@'localhost', 'constructcare'@'127.0.0.1';
FLUSH PRIVILEGES;
```

| Base | Rôle |
| :--- | :--- |
| `constructcare_dev` | Développement local |
| `constructcare_test` | Suite Vitest — **effacée par les tests**, ne jamais y mettre de données utiles |
| `constructcare_shadow` | Base temporaire de `prisma migrate dev` |

L'API ne se connecte **jamais** en `root` : elle utilise l'utilisateur dédié `constructcare`, limité à ces trois bases.

### 3. Variables d'environnement

```bash
cp .env.example .env
```

Puis renseigner au minimum :

```env
DATABASE_URL=mysql://constructcare:<mot_de_passe>@127.0.0.1:3306/constructcare_dev
SHADOW_DATABASE_URL=mysql://constructcare:<mot_de_passe>@127.0.0.1:3306/constructcare_shadow
JWT_SECRET=<chaine_aleatoire_forte>   # openssl rand -hex 48
PORT=3005
```

> ⚠️ Encoder les caractères spéciaux du mot de passe dans l'URL (`@` → `%40`, `!` → `%21`).

Créer également `.env.test` pour la suite de tests (même utilisateur, base `constructcare_test`) :

```env
DATABASE_URL=mysql://constructcare:<mot_de_passe>@127.0.0.1:3306/constructcare_test
SHADOW_DATABASE_URL=mysql://constructcare:<mot_de_passe>@127.0.0.1:3306/constructcare_shadow
JWT_SECRET=<secret_de_test>
NODE_ENV=test
PORT=3006
```

`.env` et `.env.test` sont ignorés par Git.

### 4. Dépendances

```bash
npm install
```

### 5. Application du schéma

```bash
npx prisma generate       # Génère le client Prisma typé
npx prisma migrate deploy # Applique les migrations versionnées (production & CI)
```

En développement, pour créer une nouvelle migration après modification de `schema.prisma` :

```bash
npm run prisma:migrate    # prisma migrate dev
```

### 6. Peuplement des données de démonstration (Seed)

```bash
npx prisma db seed        # ou : npm run prisma:seed
```

> **⚠️ Le seed est destructif.** Il vide au préalable les tables `Document`, `MaterialMovement`,
> `Material`, `ProgressPhoto`, `Expense`, `Task`, `ProjectAssignment`, `Project`, `User`, `Company`
> et `SubscriptionConfig`. À réserver aux bases de développement.

Le seed crée :

* Les **3 forfaits d'abonnement** (`FREE`, `STANDARD`, `PREMIUM`) — indispensables au fonctionnement de l'API (`GET /auth/plans`, contrôle des quotas de chantiers/utilisateurs). Sans eux, l'inscription et la création de chantiers échouent.
* Une **entreprise de démonstration** : « Bâtisseur du Golfe S.A. » (plan `PREMIUM`).
* Les **5 comptes de test** décrits plus bas.

### 7. Préparation de la base de test

```bash
npm run test:db:setup     # Applique les migrations sur constructcare_test
```

À rejouer après chaque nouvelle migration.

---

## 🏃 Scripts disponibles

| Script | Description |
| :--- | :--- |
| `npm run dev` | Démarre l'API en développement (`ts-node`) sur le port défini par `PORT` |
| `npm run build` | Compile TypeScript vers `dist/` |
| `npm start` | Lance l'API compilée (production) |
| `npm run prisma:generate` | Régénère le client Prisma |
| `npm run prisma:migrate` | Crée et applique une migration (développement) |
| `npm run prisma:deploy` | Applique les migrations existantes (production / CI) |
| `npm run prisma:seed` | Peuple la base de développement |
| `npm run db:check` | Affiche la base courante et ses tables (diagnostic) |
| `npm run test:db:setup` | Applique les migrations sur `constructcare_test` |
| `npm test` | Suite Vitest (16 tests) |
| `npm run verify:tenant` | Vérifie l'isolation multi-tenant — **nécessite l'API démarrée** |

---

## 📌 Comptes de test créés par le seed

Mot de passe commun : **`Pass@2026`**. La connexion accepte l'email **ou** le téléphone (saisie abrégée tolérée).

| Rôle | Email | Téléphone |
| :--- | :--- | :--- |
| **Super Administrateur** | `superadmin@togo.com` | `+228 99 99 99 99` (ou `99999999`) |
| **Administrateur / Gérant** | `admin@togo.com` | `+228 90 12 34 56` (ou `90123456`) |
| **Chef d'équipe** | `chef@togo.com` | `+228 91 23 45 67` (ou `91234567`) |
| **Ouvrier de terrain** | `ouvrier@togo.com` | `+228 92 34 56 78` (ou `92345678`) |
| **Client propriétaire** | `client@togo.com` | `+228 93 45 67 89` (ou `93456789`) |

---

## 🗄️ Notes spécifiques MySQL

* **Champs longs.** MySQL fait correspondre un `String` Prisma non annoté à `VARCHAR(191)` et rejette
  toute valeur plus longue — contrairement au type `text` illimité de PostgreSQL. Les colonnes
  pouvant recevoir une URL S3 ou une image Base64 de repli (`ProgressPhoto.photoUrl`,
  `Document.clientSignature`, `Document.pdfUrl`, `Expense.receiptUrl`, `Company.logoUrl`) sont donc
  typées explicitement en `@db.Text` / `@db.LongText`. `tests/mysql-columns.test.ts` verrouille ce
  comportement. **Toute nouvelle colonne de texte libre doit être dimensionnée explicitement.**
* **Comparaisons insensibles à la casse.** La collation `utf8mb4_unicode_ci` rend les comparaisons
  de chaînes insensibles à la casse : `admin@togo.com` et `Admin@Togo.com` sont considérés
  identiques (recherche de connexion et contrainte d'unicité sur `User.email`). Comportement
  souhaitable pour des emails, mais différent de PostgreSQL.
* **Charge utile.** L'API accepte des corps JSON jusqu'à 50 Mo. Si des images Base64 volumineuses
  sont stockées en base, aligner `max_allowed_packet` côté MySQL (défaut 64 Mo).
* **Casse des noms de tables.** Sous Windows, MySQL stocke les noms de tables en minuscules
  (`lower_case_table_names=1`) ; sous Linux, la casse est significative par défaut. Un dump pris sous
  Windows et restauré sous Linux nécessite d'initialiser le serveur avec `lower_case_table_names=1`.
