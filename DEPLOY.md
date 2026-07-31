# Déploiement

Push-to-deploy : GitHub Actions construit l'image, la pousse sur `ghcr.io`, puis déclenche un redéploiement Dokploy.

| Branche | Tag image | Cible |
| :--- | :--- | :--- |
| `develop` | `develop` | application Dokploy **DEV** |
| `main` | `latest` | application Dokploy **PRODUCTION** |

Workflow Git : push libre sur `develop` → MR `develop → staging` → MR `staging → master`. Jamais `develop → master` en direct.

---

## Variables d'environnement requises

Voir `.env.example` pour la liste complète. Le strict minimum au démarrage :

| Variable | Rôle |
| :--- | :--- |
| `DATABASE_URL` | Connexion MySQL |
| `JWT_SECRET` | Signature des jetons — le serveur refuse de démarrer sans |
| `CORS_ORIGIN` | Origines autorisées, **obligatoire en production** |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Uniquement tant qu'aucun `SUPER_ADMIN` n'existe (≥ 12 caractères) |

Secrets GitHub Actions : `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `DOKPLOY_APP_DEV_ID`, `DOKPLOY_APP_PROD_ID`.

---

## Ce que fait le conteneur au démarrage

1. `docker-entrypoint.sh` → `prisma migrate deploy` (migrations versionnées uniquement, aucune destruction). Désactivable via `RUN_DB_MIGRATE=false`.
2. `node dist/index.js` → `src/bootstrap/` refait migrations + amorçage (3 forfaits système + 1 Super Administrateur) quand `NODE_ENV=production`. Désactivable via `BOOTSTRAP_ON_START=false`.

Les deux étapes sont **idempotentes** : les cumuler est sans risque. Pour n'en garder qu'une, désactiver l'autre.

> ⚠️ **Ne jamais revenir à `prisma db push --accept-data-loss` dans l'entrypoint.** Depuis l'existence de `prisma/migrations/`, cette commande aligne le schéma en **supprimant sans confirmation** toute colonne ou table absente du schéma Prisma.

---

## Base existante créée par `db push`

**Symptôme :** le conteneur s'arrête au démarrage avec `Error: P3005 — The database schema is not empty`.

**Cause :** un déploiement antérieur à l'introduction des migrations versionnées utilisait `prisma db push`. Les tables existent, mais la table d'historique `_prisma_migrations` est absente : `migrate deploy` refuse d'agir sur une base dont il ne connaît pas l'état.

> ⚠️ **Ceci concerne aussi la PRODUCTION, vérifié et non hypothétique.** La CI a exécuté deux déploiements réussis sur `main` le 2026-07-28 (commits `6d9dcd6` et `612347a`), avec l'ancien entrypoint `db push`. La base de production est donc très probablement dans le même état que la base DEV décrite ci-dessus — sauf qu'elle est en service depuis cette date et peut contenir de vraies données. **Avant tout merge `develop → staging → main` de ce correctif**, vérifier concrètement le contenu de la base de production (nombre d'entreprises, d'utilisateurs, de chantiers réels) : si elle contient des données réelles, suivre impérativement le chemin « base avec données réelles » ci-dessous, jamais un reset.
>
> L'entrypoint refuse structurellement tout reset quand `NODE_ENV=production`, y compris si `DB_RESET_ON_P3005` était positionnée par erreur (copier-coller de configuration entre applications Dokploy) : deux couches de protection indépendantes.

### Ne pas baseliner à l'aveugle

La tentation est de marquer les migrations comme déjà appliquées :

```bash
npx prisma migrate resolve --applied 20260729163228_init_mysql
```

**C'est faux dans le cas général**, et vérifié comme tel : le schéma poussé par `db push` provenait d'une version antérieure du fichier `schema.prisma`. Il lui manque les colonnes d'identifiants en `VARCHAR(36)`, les 18 index de clés étrangères, et la table `MobileMoneyTransaction`. Baseliner déclare ces éléments présents alors qu'ils ne le sont pas :

* la dérive de schéma devient invisible ;
* la migration suivante échoue (clé étrangère vers une colonne de type incompatible, ou table déjà existante) et laisse la base dans un état de **migration échouée**, qui bloque toutes les migrations ultérieures.

### Choisir selon la base concernée

**Base DEV, sans donnée à conserver** — remise à zéro depuis le conteneur, sans accès shell :

1. Dans Dokploy, ajouter la variable d'environnement `DB_RESET_ON_P3005=true` sur l'application **DEV**.
2. Redéployer. L'entrypoint recrée le schéma à partir des migrations versionnées.
3. **Retirer la variable** immédiatement après.

> ⚠️ Cette variable supprime **toutes** les données de la base visée. Ne jamais la laisser en place, ni la positionner sur l'application de production.
>
> Sûreté par construction : cette branche n'est atteignable que sur une base dépourvue de `_prisma_migrations`, c'est-à-dire jamais gérée par les migrations. Une base correctement déployée possède cet historique et ne peut donc pas déclencher P3005 — le reset y est structurellement inatteignable, même si la variable traînait.

Le démarrage suivant recrée automatiquement les 3 forfaits et le Super Administrateur via `src/bootstrap/`.

**Base contenant des données réelles** — ne rien exécuter à l'aveugle :

1. Sauvegarder (`mysqldump`).
2. Comparer le schéma réel aux migrations (`npx prisma migrate diff --from-url "$DATABASE_URL" --to-migrations prisma/migrations --shadow-database-url "$SHADOW_DATABASE_URL"`).
3. Si et seulement si le schéma correspond exactement : baseliner chaque migration déjà reflétée en base avec `migrate resolve --applied`.
4. Sinon, écrire une migration de rattrapage à partir du diff obtenu.

---

## Notes MySQL

* **Casse des noms de tables.** Sous Windows, MySQL stocke les noms en minuscules (`lower_case_table_names=1`) ; sous Linux (conteneur de production), la casse est significative. Les migrations créant explicitement `` `Company` ``, `` `User` ``… en PascalCase, une base créée **par les migrations** est cohérente sur les deux systèmes. Le risque ne concerne qu'un dump pris sous Windows et restauré sous Linux : initialiser alors le serveur avec `lower_case_table_names=1`.
* **Taille des requêtes.** L'API accepte des corps JSON jusqu'à 50 Mo (images Base64 en repli quand S3 échoue). Vérifier que `max_allowed_packet` de l'instance MySQL est au moins équivalent (défaut : 64 Mo).
* **Pool de connexions.** En production, borner via l'URL : `?connection_limit=10&pool_timeout=20`.
