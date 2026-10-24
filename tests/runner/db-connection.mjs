import prompts from "prompts";

import { drizzle as mysql_drizzle } from "drizzle-orm/mysql2";
import { drizzle as pg_drizzle } from "drizzle-orm/node-postgres";
import { drizzle as postgres_js_drizzle } from "drizzle-orm/postgres-js";
import { drizzle as neon_drizzle } from "drizzle-orm/neon-http";
import { drizzle as vercel_drizzle } from "drizzle-orm/vercel-postgres";
import { drizzle as libsql_drizzle } from "drizzle-orm/libsql";
import { drizzle as d1_drizzle } from "drizzle-orm/d1";
import { drizzle as better_sqlite_drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as pglite_drizzle } from "drizzle-orm/pglite";
import { drizzle as mssql_drizzle } from 'drizzle-orm/node-mssql';

export async function create_connection(db_select, config = {}) {
  const on_cancel = () => {
    console.log("\nCancelled by user");
    process.exit(1);
  };

  console.clear();
  console.log("--[ database configuration ]--");

  const { db_address, user_name, password, db_name } = await prompts([
    {
      type: "text",
      name: "db_address",
      message: `Enter ${db_select.family} db host/address`,
    },
    {
      type: "text",
      name: "user_name",
      message: `Enter ${db_select.family} db user name`,
    },
    {
      type: "password",
      name: "password",
      message: `Enter ${db_select.family} db password`,
    },
    {
      type: "text",
      name: "db_name",
      message: `Enter ${db_select.family} db name`,
    },
  ], { onCancel: on_cancel });

  return { db_address, user_name, password, db_name };
}

export async function get_db(family, db_address, user_name, password, db_name, schema) {
  let db;

  switch (family) {

    case "mysql": {
      const mysql = await import("mysql2/promise");

      const pool = mysql.createPool({
        host: db_address,
        user: user_name,
        password,
        database: db_name,
        port: 3306,
      });

      db = mysql_drizzle({
        client: pool,
        schema,
        mode: "default",
      });
      break;
    }

    case "postgres": {
      const { Pool } = await import("pg");

      const pool = new Pool({
        host: db_address,
        user: user_name,
        password,
        database: db_name,
        port: 5432,
      });

      db = pg_drizzle({
        client: pool,
        schema,
        mode: "default",
      });
      break;
    }

    case "postgres-js": {
      const postgres = (await import("postgres")).default;

      const client = postgres(
        `postgres://${user_name}:${password}@${db_address}:5432/${db_name}`
      );

      db = postgres_js_drizzle(client, { schema, mode: 'default' });
      break;
    }

    case "neon":
    case "neon-http": {
      const { neon } = await import("@neondatabase/serverless");

      const sql = neon(
        `postgres://${user_name}:${password}@${db_address}/${db_name}`
      );

      db = neon_drizzle(sql, { schema, mode: 'default' });
      break;
    }

    case "vercel-pg": {
      const { sql } = await import("@vercel/postgres");

      db = vercel_drizzle(sql, { schema, mode: 'default' });
      break;
    }

    case "better-sqlite3": {
      const database = (await import("better-sqlite3")).default;

      const sqlite = new database(db_name);

      db = better_sqlite_drizzle(sqlite, { schema, mode: 'default' });
      break;
    }

    case "libsql": {
      const { createClient: create_client } = await import("@libsql/client");

      const client = create_client({
        url: db_address,
        authToken: password,
      });

      db = libsql_drizzle(client, { schema, mode: 'default' });
      break;
    }

    case "d1":
    case "drizzle-d1": {
      if (!config.d1) {
        throw new Error("Missing D1 binding in config");
      }

      db = d1_drizzle(config.d1);
      break;
    }

    case "pglite": {
      const { PGlite } = await import("@electric-sql/pglite");

      const client = new PGlite();

      db = pglite_drizzle(client, { schema, mode: 'default' });
      break;
    }

    case "mssql": {
      const mssql_module = await import("mssql");
      const mssql = mssql_module.default ?? mssql_module;

      const pool = await mssql.connect({
        user: user_name,
        password: password,
        server: db_address, // MUST be string like "localhost"
        database: db_name,
        port: 1433,
        options: {
          encrypt: true,
          trustServerCertificate: true,
        },
      });

      const { drizzle } = await import("drizzle-orm/node-mssql");

      db = drizzle({ client: pool });

      break;
    }

    case "aws-pg": {
      const { RDSDataClient } = await import("@aws-sdk/client-rds-data");
      const { drizzle: aws_drizzle } = await import("drizzle-orm/aws-data-api/pg");

      const client = new RDSDataClient({
        region: config.region,
      });

      db = aws_drizzle(client, {
        database: db_name,
        secretArn: config.secretArn,
        resourceArn: config.resourceArn,
        schema
      });

      break;
    }

    default:
      throw new Error(`Unsupported DB type: ${family}`);
  }

  return db;
}