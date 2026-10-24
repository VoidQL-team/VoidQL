import * as schema from './schema';
import { get_db } from "./runner/db-connection.mjs"
import path from "path";
import fs from "fs/promises";
import structure from "./auto_tests/auto_tests_structure"
import { TableStructure } from '../src/types';
import { it, expect } from "vitest";

const db_host = process.env.DB_HOST || null;
const db_user = process.env.DB_USER || null;
const db_pwd = process.env.DB_PWD || null;
const db_name = process.env.DB_NAME || null;
const selected_family = process.env.DB_FAMILY || null;
const local_user = process.env.USER_OBJ ? JSON.parse(process.env.USER_OBJ) : null
const role = process.env.USER_ROLE ? process.env.USER_ROLE : null
const run_mode = process.env.RUN_MODE ? process.env.RUN_MODE : "sequential"

if(db_host == null) throw Error('DB host not passed')
if(db_user == null) throw Error('DB user not passed')
if(db_pwd == null) throw Error('DB password not passed')
if(db_name == null) throw Error('DB name not passed')
if(role == null) throw Error('Role not passed')
if(local_user == null) throw Error('User object not passed')
if(selected_family == null) throw Error('database family not selected')

let db = await get_db(selected_family, db_host, db_user, db_pwd, db_name, schema)

type TestStatus = "passed" | "failed" | "missing" | "invalid";

type TestResult =
  | { file: string; status: TestStatus; error?: unknown }
  | { file: string; status: TestStatus };

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

let injected_structure = inject_schema_into_table(structure as any, schema)

async function run_tests(mode: "sequential" | "parallel" = "sequential") {
  const dir = path.resolve("./tests/auto_tests");

  const files = await fs.readdir(dir);

  const test_files = files
    .filter((f) => f.startsWith("test_") && f.endsWith(".js"))
    .sort();

  const run_one = async (file: string): Promise<TestResult> => {
    const file_path = path.resolve(dir, file);

    let module;

    try {
      module = await import(file_path);
    } catch (err: any) {
      console.warn(`${file} failed to import`, err.message);
      return { file, status: "missing" };
    }

    const test_fn = module.default;

    if (typeof test_fn !== "function") {
      console.warn(`${file} has no default export function`);
      return { file, status: "invalid" };
    }

    console.log(`Running ${file}`);

    try {
      await test_fn(db, injected_structure, local_user, role);
      return { file, status: "passed" };
    } catch (err) {
      console.error(`${file} failed`, err);
      return { file, status: "failed", error: err };
    }
  };

  if (mode === "sequential") {
    const results: TestResult[] = [];

    for (const file of test_files) {
      results.push(await run_one(file));
    }

    return results;
  }

  return Promise.all(test_files.map(run_one));
}

it("runs VoidQL auto test suite", async () => {
  const results = await run_tests(
    run_mode === "parallel" ? "parallel" : "sequential"
  );

  if (!results) throw new Error("No tests were run");

  console.log("Test results:", results);

  const summary: Record<TestStatus, number> = {
    passed: 0,
    failed: 0,
    missing: 0,
    invalid: 0,
  };

  for (const r of results) {
    summary[r.status]++;
  }

  console.log(
    `Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.missing} missing, ${summary.invalid} invalid`
  );

  // IMPORTANT: make Vitest actually assert something
  expect(summary.failed).toBe(0);
});