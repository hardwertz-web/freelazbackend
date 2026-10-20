import { PrismaClient } from "@prisma/client";

// Evita múltiplas instâncias do Prisma Client em hot-reload durante o desenvolvimento
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
