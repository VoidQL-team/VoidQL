import prompts from 'prompts';

export const database_map = {
  mysql: [
    { title: 'MySQL (Generic)', value: 'mysql' },
    { title: 'MySQL2', value: 'mysql2' },
    { title: 'PlanetScale', value: 'planetscale' },
    { title: 'Prisma MySQL', value: 'prisma-mysql' },
    { title: 'MySQL Remote', value: 'mysql-remote' }
  ],

  postgres: [
    { title: 'PostgreSQL (Generic)', value: 'pg' },
    { title: 'Node PG', value: 'node-pg' },
    { title: 'Postgres.js', value: 'postgres-js' },
    { title: 'Neon', value: 'neon' },
    { title: 'Neon HTTP', value: 'neon-http' },
    { title: 'Vercel PG', value: 'vercel-pg' },
    { title: 'PGlite', value: 'pglite' },
    { title: 'PostgreSQL Remote', value: 'pg-remote' },
    { title: 'Prisma PostgreSQL', value: 'prisma-pg' },
    { title: 'AWS Data API PG', value: 'aws-pg' }
  ],

  sqlite: [
    { title: 'BetterSQLite3', value: 'better-sqlite3' },
    { title: 'LibSQL', value: 'libsql' },
    { title: 'SQL.js', value: 'sqljs' },
    { title: 'Base SQLite', value: 'sqlite-base' },
    { title: 'Expo SQLite', value: 'expo-sqlite' },
    { title: 'Bun SQLite', value: 'bun-sqlite' },
    { title: 'SQLite Remote', value: 'sqlite-remote' },
    { title: 'Prisma SQLite', value: 'prisma-sqlite' },
    { title: 'OP SQLite', value: 'op-sqlite' }
  ],

  edge: [
    { title: 'Cloudflare D1', value: 'd1' },
    { title: 'Drizzle D1', value: 'drizzle-d1' },
    { title: 'Drizzle SQLite DO', value: 'drizzle-sqlite-do' }
  ],

  cloud: [
    { title: 'Xata HTTP', value: 'xata-http' },
    { title: 'TiDB Serverless', value: 'tidb-serverless' },
    { title: 'SingleStore', value: 'singlestore' },
    { title: 'SingleStore Remote', value: 'singlestore-remote' }
  ],

  gel: [
    { title: 'Gel database', value: 'gel' },
    { title: 'Gel JS', value: 'gel-js' }
  ],

  mssql: [
    { title: 'MSSQL', value: 'mssql' },
  ]
};

export async function select() {
    let family
    let db
    while (!db) {
      console.clear();
      // Step 1: select family if undefined
      if (!family) {
        const family_resp = await prompts(
            {
            type: 'select',
            name: 'family',
            message: 'Select database family',
            choices: [
                ...Object.keys(database_map).map((key) => ({
                title: key.toUpperCase(),
                value: key
                })),
                { title: 'Exit', value: null }
            ]
            },
            {
            onCancel: () => {
                console.log('\nCancelled');
                process.exit(1);
            }
            }
        );

        if (!family_resp.family) {
            console.error('No family selected');
            process.exit(1);
        }

        family = family_resp.family;
      }

      // Step 2: select db with "< Previous" option
      const db_resp = await prompts(
        {
            type: 'select',
            name: 'db',
            message: `Select ${family} implementation`,
            choices: [
            ...database_map[family],
            { title: '<', value: '__previous' }
            ]
        },
        {
            onCancel: () => {
            console.log('\nCancelled');
            process.exit(1);
            }
        }
      );

      if (!db_resp.db) {
        console.error('No database selected');
        process.exit(1);
      }

      if (db_resp.db === '__previous') {
        family = undefined; // go back to family selection
        continue;
      }

      db = db_resp.db;
    }

    return {db, family}
}