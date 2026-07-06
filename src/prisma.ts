import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const basePrisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

export const prisma = basePrisma.$extends({
  result: {
    subscriptionConfig: {
      features: {
        needs: { features: true },
        compute(sc) {
          const raw = sc.features;
          if (typeof raw === 'string') {
            return raw ? raw.split(',').filter(Boolean) : [];
          }
          return raw || [];
        },
      },
    },
  },
  query: {
    subscriptionConfig: {
      async create({ args, query }) {
        if (args.data.features && Array.isArray(args.data.features)) {
          (args.data as any).features = args.data.features.join(',');
        }
        return query(args);
      },
      async update({ args, query }) {
        if (args.data.features && Array.isArray(args.data.features)) {
          (args.data as any).features = args.data.features.join(',');
        }
        return query(args);
      },
      async updateMany({ args, query }) {
        if (args.data.features && Array.isArray(args.data.features)) {
          (args.data as any).features = args.data.features.join(',');
        }
        return query(args);
      },
      async upsert({ args, query }) {
        if (args.create.features && Array.isArray(args.create.features)) {
          (args.create as any).features = args.create.features.join(',');
        }
        if (args.update.features && Array.isArray(args.update.features)) {
          (args.update as any).features = args.update.features.join(',');
        }
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;
