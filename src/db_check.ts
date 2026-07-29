import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Connexion à la base de données...');

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT DATABASE() AS db`;
    console.log('Base courante :', db);

    const tables = await prisma.$queryRaw<{ table_name: string; table_rows: bigint }[]>`
      SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;
    console.log(`Tables (${tables.length}) :`);
    for (const t of tables) {
      console.log(`  - ${t.table_name} (~${t.table_rows} lignes)`);
    }
  } catch (error) {
    console.error('Erreur lors de l’interrogation de la base :', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
