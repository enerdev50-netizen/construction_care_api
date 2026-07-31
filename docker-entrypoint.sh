#!/bin/sh
# Applique les migrations versionnées avant de démarrer l'API.
#
# Historique : ce script utilisait `prisma db push --accept-data-loss`, faute de
# migrations versionnées dans le projet. Elles existent désormais
# (`prisma/migrations/`, cf. P1-6), et `db push --accept-data-loss` est
# dangereux sur une base de production : il aligne le schéma en supprimant sans
# confirmation les colonnes/tables absentes du schéma Prisma. `migrate deploy`
# est la commande prévue pour la production : elle applique uniquement les
# migrations en attente, n'en génère aucune et ne détruit rien.
#
# Idempotent : sans migration en attente, la base n'est pas modifiée.
# RUN_DB_MIGRATE=false pour désactiver (ex. schéma géré par un autre processus).
#
# Note : `src/bootstrap/` applique déjà migrations + amorçage au démarrage du
# serveur quand NODE_ENV=production. Les deux sont idempotents et donc sûrs
# cumulés ; pour ne garder qu'un seul mécanisme, désactiver l'autre via
# RUN_DB_MIGRATE=false ou BOOTSTRAP_ON_START=false.
set -e

if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
  echo "▶ Application des migrations Prisma…"

  if ! npx prisma migrate deploy > /tmp/migrate-deploy.log 2>&1; then
    cat /tmp/migrate-deploy.log

    # P3005 : la base contient déjà des tables mais aucun historique de
    # migrations. C'est l'état laissé par un déploiement antérieur basé sur
    # `prisma db push`. Ne JAMAIS baseliner automatiquement ici : le schéma
    # poussé peut différer de celui des migrations (types de colonnes, index
    # manquants), et marquer les migrations « appliquées » masquerait cette
    # dérive jusqu'à un échec bien plus tardif et plus coûteux.
    if grep -q "P3005" /tmp/migrate-deploy.log; then

      # Remise à zéro explicite, réservée aux bases jetables (DEV).
      #
      # Sûreté : cette branche n'est atteignable QUE sur une base dépourvue de
      # table `_prisma_migrations`, c'est-à-dire une base qui n'a jamais été
      # gérée par les migrations. Une base correctement déployée via
      # `migrate deploy` possède cet historique et ne peut donc pas déclencher
      # P3005 — le reset y est structurellement inatteignable. Il faut en plus
      # positionner explicitement la variable ci-dessous.
      if [ "${DB_RESET_ON_P3005:-false}" = "true" ]; then
        echo ""
        echo "⚠️  DB_RESET_ON_P3005=true → REMISE À ZÉRO de la base."
        echo "⚠️  Toutes les données existantes vont être supprimées."
        npx prisma migrate reset --force --skip-seed --skip-generate
        echo "✓ Base recréée à partir des migrations versionnées."
        echo "→ Retirer DB_RESET_ON_P3005 de la configuration : cette variable"
        echo "  ne doit jamais rester en place après usage."
      else
        echo ""
        echo "════════════════════════════════════════════════════════════════"
        echo "  La base contient des tables mais aucun historique de migrations"
        echo "  (état typique d'un déploiement antérieur via 'prisma db push')."
        echo ""
        echo "  → Base DEV sans donnée à conserver : ajouter la variable"
        echo "    DB_RESET_ON_P3005=true, redéployer une fois, puis la retirer."
        echo ""
        echo "  → Base contenant des données réelles : NE PAS faire cela."
        echo "    Suivre DEPLOY.md, section « Base existante créée par db push »"
        echo "    (sauvegarde, diff, migration de rattrapage)."
        echo ""
        echo "  Ne pas baseliner sans avoir vérifié que le schéma en base"
        echo "  correspond réellement aux migrations : sinon la dérive est"
        echo "  masquée et casse plus tard."
        echo "════════════════════════════════════════════════════════════════"
        exit 1
      fi
    else
      exit 1
    fi
  else
    cat /tmp/migrate-deploy.log
  fi

  echo "✓ Migrations à jour"
fi

exec "$@"
