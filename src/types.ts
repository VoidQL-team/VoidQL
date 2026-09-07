/* -------------------------------------------------------------------------- */
/*                                   IMPORTS                                  */
/* -------------------------------------------------------------------------- */
import { GelDatabase, GelTransaction } from "drizzle-orm/gel-core";
import { MySql2Database, MySql2Transaction } from "drizzle-orm/mysql2";
import { PlanetScaleDatabase, PlanetScaleTransaction } from "drizzle-orm/planetscale-serverless";
import { PgAsyncDatabase, PgAsyncTransaction } from "drizzle-orm/pg-core";
import { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import { VercelPgDatabase, VercelPgTransaction } from "drizzle-orm/vercel-postgres";
import { LibSQLDatabase, LibSQLTransaction } from "drizzle-orm/libsql";
import { BetterSQLite3Database, BetterSQLiteTransaction } from "drizzle-orm/better-sqlite3";
import { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { NeonDatabase, NeonTransaction } from "drizzle-orm/neon-serverless";
import { GelJsDatabase } from "drizzle-orm/gel";
import { AnyD1Database, DrizzleD1Database } from "drizzle-orm/d1";
import { SQLJsDatabase, SQLJsTransaction } from "drizzle-orm/sql-js";
import { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite";
import { XataHttpDatabase } from "drizzle-orm/xata-http";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { OPSQLiteDatabase, OPSQLiteTransaction } from "drizzle-orm/op-sqlite";
import { PgRemoteDatabase } from "drizzle-orm/pg-proxy";
import { PrismaPgDatabase } from "drizzle-orm/prisma/pg";
import { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { SingleStoreRemoteDatabase } from "drizzle-orm/singlestore-proxy";
import { SingleStoreDatabase } from "drizzle-orm/singlestore";
import { TiDBServerlessDatabase, TiDBServerlessTransaction } from "drizzle-orm/tidb-serverless";
import { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { PrismaSQLiteDatabase } from "drizzle-orm/prisma/sqlite";
import { AwsDataApiPgDatabase, AwsDataApiTransaction } from "drizzle-orm/aws-data-api/pg";
import { PrismaMySqlDatabase } from "drizzle-orm/prisma/mysql";
import { MySqlRemoteDatabase } from "drizzle-orm/mysql-proxy";
import { PostgresJsDatabase, PostgresJsTransaction } from "drizzle-orm/postgres-js";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { ExpoSQLiteDatabase, ExpoSQLiteTransaction } from "drizzle-orm/expo-sqlite";
import { MySqlDatabase, MySqlTransaction } from "drizzle-orm/mysql-core";
import { SingleStoreTransaction } from "drizzle-orm/singlestore-core";

/* -------------------------------------------------------------------------- */
/*                               DATABASE TYPES                               */
/* -------------------------------------------------------------------------- */

export type Database =
  | GelDatabase<any, any, any>
  | MySql2Database
  | PlanetScaleDatabase
  | PgAsyncDatabase<any, any, any>
  | NodePgDatabase
  | NeonDatabase
  | VercelPgDatabase
  | LibSQLDatabase
  | BetterSQLite3Database
  | GelJsDatabase
  | MySqlDatabase<any, any, any, any>
  | AnyD1Database
  | SQLJsDatabase
  | PgliteDatabase
  | XataHttpDatabase
  | NeonHttpDatabase
  | OPSQLiteDatabase
  | PgRemoteDatabase
  | PrismaPgDatabase
  | DrizzleSqliteDODatabase
  | SingleStoreRemoteDatabase
  | TiDBServerlessDatabase
  | SqliteRemoteDatabase
  | PrismaSQLiteDatabase
  | AwsDataApiPgDatabase
  | SingleStoreDatabase<any, any, any, any>
  | DrizzleD1Database
  | PrismaMySqlDatabase
  | MySqlRemoteDatabase
  | PostgresJsDatabase
  | BaseSQLiteDatabase<any, any, any, any>
  | ExpoSQLiteDatabase
  | SQLiteBunDatabase;

export type Transaction =
  | GelTransaction<any, any, any>
  | MySql2Transaction<any, any, any>
  | PlanetScaleTransaction<any, any, any>
  | PgAsyncTransaction<any, any, any>
  | NodePgTransaction<any, any, any>
  | NeonTransaction<any, any, any>
  | VercelPgTransaction<any, any, any>
  | LibSQLTransaction<any, any, any>
  | BetterSQLiteTransaction<any, any, any>
  | MySqlTransaction<any, any, any>
  | SQLJsTransaction<any, any, any>
  | PgliteTransaction<any, any, any>
  | OPSQLiteTransaction<any, any, any>
  | SingleStoreTransaction<any, any, any>
  | TiDBServerlessTransaction<any, any, any>
  | AwsDataApiTransaction<any, any, any>
  | SingleStoreTransaction<any, any>
  | PostgresJsTransaction<any, any, any>
  | ExpoSQLiteTransaction<any, any, any>

/* -------------------------------------------------------------------------- */
/*                                  STRUCTURE                                 */
/* -------------------------------------------------------------------------- */

export type Structure = Record<string, TableStructure>;

export type TableStructure = {
  endpoints: Endpoint[];
  table: any;
};

export const BuildWhereOptionsDefaults:BuildWhereOptions = {
  disable_triggers: false
}

export type BuildWhereOptions = {
  disable_triggers?: boolean
}

export type SetCondition = {
  field: string;
  when: WhereCondition | SubqueryCondition;
  value: any;
  else_value?: any;
}

export type SetValue = {
  set: SetCondition
}

export type EndpointType = "GET" | "PUT" | "POST" | "DELETE";
export type TriggerQuery =
	| SetValue
	| IfCondition & SetValue
	| StructuredQuery;

export type TriggerStructure = {
	type: "BEFORE" | "AFTER";
	query: TriggerQuery;
};

// Endpoint structure
export type Endpoint = {
  // Explicit properties
  type: EndpointType;
  triggers?: TriggerStructure[];

  
  // Dynamic role properties
  [role: string]: 
    | RolePermissions 
    | typeof NONE 
    | any;
};

/* -------------------------------------------------------------------------- */
/*                                 PERMISSIONS                                */
/* -------------------------------------------------------------------------- */

export type AllowedAliases =
  | { allowed: FieldPermission; allow?: never }
  | { allow: FieldPermission; allowed?: never };

export type DisallowedAliases =
  | { disallowed?: FieldPermission; deny?: never }
  | { deny?: FieldPermission; disallowed?: never };

export type Limit = { limit?: number };

export type OrderBy = { order_by?: string[] | string };

export type GroupBy = { group_by?: string[] | string };

export type Returning = {
  returning?: AllowedAliasesReturning & DisallowedAliasesReturning & boolean;
}

export type RolePermissions = AllowedAliases & DisallowedAliases & Limit & OrderBy & Returning & GroupBy;

export type AllowedAliasesReturning =
  | { allowed: string | string[]; allow?: never }
  | { allow: string | string[]; allowed?: never };

export type DisallowedAliasesReturning =
  | { disallowed?: string | string[]; deny?: never }
  | { deny?: string | string[]; disallowed?: never };

export type FieldPermission =
  | string | string[]
  | {
      field: string | string[];
      where?: WhereCondition;
    };

/* -------------------------------------------------------------------------- */
/*                                  OPERATORS                                 */
/* -------------------------------------------------------------------------- */

export const BASIC_OPERATORS = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "LIKE",
  "NOT LIKE",
  "ILIKE",
  "NOT ILIKE",
  "IS",
  "IS NOT",
  "IS NULL",
  "IS NOT NULL",
  "IN",
  "NOT IN",
  "IS PASSED",
  "IS NOT PASSED"
] as const;

export type SafeOperator = typeof BASIC_OPERATORS[number];

/* -------------------------------------------------------------------------- */
/*                                   RESULT                                   */
/* -------------------------------------------------------------------------- */

export type CompileExecutionResult<T = any> = {
  ok: boolean;
  data?: T[];
  error?: unknown[] | unknown;
};

export type ExecuteFunction<T = any> = () => Promise<CompileExecutionResult<T>>;

export type CompileResult<T = any> = {
  execute: ExecuteFunction<T>;
};

/* -------------------------------------------------------------------------- */
/*                                   REQUEST                                  */
/* -------------------------------------------------------------------------- */

export type PhaseTypes = "TRANSACTION" | "QUERY"

export type QueryPhase = {
  mode: PhaseTypes;
  queries: StructuredQuery[];
};

export type Request =
  | StructuredQuery
  | {
      phases: QueryPhase[];
    };

/* -------------------------------------------------------------------------- */
/*                              QUERY/CONDITIONS                              */
/* -------------------------------------------------------------------------- */

export type StructuredQuery = {
  table: keyof Structure;
  type: EndpointType;
  select?: string[] | string;
  join?: Join[];
  where?: WhereCondition;
  data?: Record<string, any> | Record<string, any>[];
  group_by?: string[] | string;
  order_by?: string[] | string;
  returning?: string[] | string;
  limit?: number;
};

export type Join = {
  table: keyof Structure;
  type: "INNER" | "LEFT";
  on: Record<string, string> | WhereCondition;
};

export type OperatorAlias =
  | { operator: SafeOperator; op?: never }
  | { op: SafeOperator; operator?: never };

export type SimpleCondition = OperatorAlias & {
  field?: string;
  left_value?: any;
  value?: any;
  start?:any;
  end?:any;
};

export type BetweenCondition =
  | {
      operator: "BETWEEN";
      op?: never;

      field: string;
      start: any;
      end: any;
    }
  | {
      op: "BETWEEN";
      operator?: never;

      field: string;
      start: any;
      end: any;
    };

export type NotBetweenCondition =
  | {
      operator: "BETWEEN";
      op?: never;

      field: string;
      start: any;
      end: any;
    }
  | {
      op: "BETWEEN";
      operator?: never;

      field: string;
      start: any;
      end: any;
    };

export type ExistsCondition =
  | {
      operator: "EXISTS";
      op?: never;
      query: {
        select: string[] | string;
        from: string;
        where?: WhereCondition;
      };
    }
  | {
      op: "EXISTS";
      operator?: never;
      query: {
        select: string[] | string;
        from: string;
        where?: WhereCondition;
      };
    };

export type NotExistsCondition =
  | {
      operator: "NOT EXISTS";
      op?: never;
      query: {
        select: string[] | string;
        from: string;
        where?: WhereCondition;
      };
    }
  | {
      op: "NOT EXISTS";
      operator?: never;
      query: {
        select: string[] | string;
        from: string;
        where?: WhereCondition;
      };
    };

export type NotCondition = {
  not: WhereCondition | SubqueryCondition;
  and?: never;
  or?: never;
  if?: never;
}

export type AndCondition = {
  and: (WhereCondition | SubqueryCondition)[];
  not?: never;
  or?: never;
  if?: never;
};

export type OrCondition = {
  or: (WhereCondition | SubqueryCondition)[];
  not?: never;
  and?: never;
  if?: never;
};

export type IfCondition = {
  if: {
    when: WhereCondition | SubqueryCondition;
    do?: WhereCondition | SubqueryCondition | boolean | StructuredQuery | Function;
    else?: WhereCondition | SubqueryCondition | boolean | StructuredQuery | Function;
  };
  not?: never;
  and?: never;
  or?: never;
};

export type NestedCondition = AndCondition | OrCondition | IfCondition | NotCondition;

// A WhereCondition can be simple or nested
export type WhereCondition = SimpleCondition | NestedCondition | ExistsCondition | NotExistsCondition | BetweenCondition | NotBetweenCondition | boolean;

// Subquery structure for IN conditions
export type SubqueryCondition = {
  field?: string;
  left_value?: any; //supports $data - $user - $col - any
  operator: "IN";
  value: {
    select: string[] | string;
    from: string;
    where?: WhereCondition;
  };
};

/* -------------------------------------------------------------------------- */
/*                                   PRESETS                                  */
/* -------------------------------------------------------------------------- */

export const ALL: RolePermissions = { allowed: ["*"], disallowed: [] };
export const ALL_EXCEPT_ID: RolePermissions = { allowed: ["*"], disallowed: ["id"] };
export const NONE: RolePermissions = { allowed: [], disallowed: [] };