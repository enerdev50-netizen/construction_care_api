import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Connecting to database...');
    const schemas: any[] = await prisma.$queryRaw`
      SELECT nspname AS schema_name, count(*) AS table_count
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND nspname NOT IN ('pg_catalog', 'information_schema')
      GROUP BY nspname
    `;
    console.log('Available schemas and table counts:', schemas);

    const tables: any[] = await prisma.$queryRaw`
      SELECT schemaname, tablename 
      FROM pg_catalog.pg_tables 
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename
    `;
    console.log('All tables details:', tables);
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
