# =============================================
# Stage 1 : dépendances complètes + build TypeScript
# =============================================
FROM node:22-alpine AS builder

# bcrypt est un module natif : outils de compilation nécessaires
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Le client Prisma doit être généré avant le tsc (les types en dépendent)
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =============================================
# Stage 2 : dépendances de production uniquement
# =============================================
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
# Le CLI prisma est désormais une dépendance de PRODUCTION : il est requis au
# runtime par l'entrypoint (`migrate deploy`) et par `src/bootstrap/`. Il est
# donc déjà installé par `npm ci --omit=dev` — plus besoin de le réinstaller.
RUN npm ci --omit=dev

# Client Prisma régénéré dans l'arbre de production
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate && rm -rf /root/.npm

# =============================================
# Stage 3 : runtime
# =============================================
FROM node:22-alpine AS runtime

RUN apk add --no-cache wget

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 expressjs

WORKDIR /app

COPY --from=deps --chown=expressjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=expressjs:nodejs /app/dist ./dist
COPY --chown=expressjs:nodejs prisma ./prisma
COPY --chown=expressjs:nodejs prisma.config.ts ./
COPY --chown=expressjs:nodejs package.json ./
COPY --chown=expressjs:nodejs docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

USER expressjs

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/ || exit 1

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
