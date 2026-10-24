import * as schema from './schema';
import { VoidQL } from "../src";
import { NONE, StructuredQuery, TableStructure } from "../src/types";
import { it, expect } from "vitest";
import { get_db } from "./runner/db-connection.mjs"

const db_host = process.env.DB_HOST || null;
const db_user = process.env.DB_USER || null;
const db_pwd = process.env.DB_PWD || null;
const db_name = process.env.DB_NAME || null;
const selected_family = process.env.DB_FAMILY || null;
const local_user = process.env.USER_OBJ ? JSON.parse(process.env.USER_OBJ) : null
const role = process.env.USER_ROLE ? process.env.USER_ROLE : null
const query:StructuredQuery = process.env.STRUCTURE_QUERY ? JSON.parse(process.env.STRUCTURE_QUERY) : null;
let structure:Record<string, TableStructure> = process.env.STRUCTURE_OBJ ? JSON.parse(process.env.STRUCTURE_OBJ) : null;

if(query == null) throw Error('Query not passed')
if(db_host == null) throw Error('DB host not passed')
if(db_user == null) throw Error('DB user not passed')
if(db_pwd == null) throw Error('DB password not passed')
if(db_name == null) throw Error('DB name not passed')
if(role == null) throw Error('Role not passed')
if(structure == null) throw Error('Structure not passed')
if(local_user == null) throw Error('User object not passed')
if(selected_family == null) throw Error('database family not selected')

let db = await get_db(selected_family, db_host, db_user, db_pwd, db_name, schema)

function inject_schema_into_table(config:Record<string, TableStructure>, schema:any) {
  const result:any = {};

  for (const key in config) {
    if (!schema[key]) {
      throw new Error(`Missing schema for key: ${key}`);
    }

    result[key] = {
      ...config[key],
      table: schema[key] // ← replace "users" with schema.users
    };
  }

  return result;
}

structure = inject_schema_into_table(structure, schema)

it("should measure build and execute performance", async () => {
  // Measure build time
  const build_start = performance.now();

  const built_query = await new VoidQL({ db, user: local_user, role, structure }).compile(query);

  const build_time = performance.now() - build_start;

  // Measure execution time
  const exec_start = performance.now();

  const result = await built_query.execute();

  const exec_time = performance.now() - exec_start;

  console.log(
    "Query result:\n",
    JSON.stringify(result, null, 2)
  );
  console.log(`Build time: ${build_time.toFixed(2)} ms`);
  console.log(`Execute time: ${exec_time.toFixed(2)} ms`);

  expect(result).toBeDefined();
});