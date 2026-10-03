import { Database, WhereCondition, StructuredQuery, Structure, BuildWhereOptions, Transaction, Request, QueryPhase, CompileResult } from "../types.js";
import { resolve_data, resolve_fields, alias_selected_fields, extractTableMap, stripPrefixes, validate_where_fields } from "../rbac.js";
import { buildAclWhere, buildWhere, delete_method, get_method, if_condition, is_allowed_empty, post_method, put_method, run_triggers } from "./drizzle.js";
import { getTableName } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/*                               REQUEST HANDLER                              */
/* -------------------------------------------------------------------------- */

export async function compile(
  db: Database | Transaction,
  request: Request,
  user: any,
  role: string,
  structure: Structure,
  options: BuildWhereOptions = {}
): Promise<CompileResult<any>> {
  if ("phases" in request && request.phases) {
    const parts = await Promise.all(
      request.phases.map((phase) =>
        build_batch(
          db,
          phase,
          user,
          role,
          structure,
          options
        )
      )
    );

    return {
      async execute() {
        const results = await Promise.all(
          parts.map((part) => part.execute())
        );

        return {
          ok: results.every((r: any) => r.ok),
          data: results
        };
      }
    };
  }

  const single = await build_query(
    db,
    request as StructuredQuery,
    user,
    role,
    structure,
    options
  );

  return {
    async execute() {
      try {
        const res = await single.execute();

        return {
          ok: true,
          data: res
        };
      } catch (err) {
        console.log(err)
        return {
          ok: false,
          error: err
        };
      }
    }
  };
}
/* -------------------------------------------------------------------------- */
/*                                QUERY BATCHER                               */
/* -------------------------------------------------------------------------- */

export async function build_batch(
  db: Database | Transaction,
  phase: QueryPhase,
  user: any,
  role: string,
  structure: Structure,
  options: BuildWhereOptions = {}
) {
  const plans = await Promise.all(
    phase.queries.map((query) =>
      build_query(
        db,
        query,
        user,
        role,
        structure,
        options
      )
    )
  );

  switch (phase.mode.toUpperCase()) {
    case "QUERY": {
      return {
        async execute() {
          const results: any[] = [];
          const errors: any[] = [];

          for (const plan of plans) {
            try {
              results.push(await plan.execute());
            } catch (err) {
              errors.push(err);
            }
          }

          return {
            ok: errors.length === 0,
            data: results,
            error: errors.length ? errors : undefined
          };
        },
      };
    }

    case "TRANSACTION": {
      return {
        async execute() {
          try {
            const results = await db.transaction(async (tx: Transaction) => {
              const values = [];

              for (const query of phase.queries) {
                const plan = await build_query(
                  tx,
                  query,
                  user,
                  role,
                  structure,
                  options
                );

                values.push(await plan.execute());
              }

              return values;
            });

            return {
              ok: true,
              data: results
            };
          } catch (err) {
            return {
              ok: false,
              error: err
            };
          }
        },
      };
    }

    default: {
      throw new Error(`Unsupported phase mode: ${phase.mode}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              BUILDER FOR QUERY                             */
/* -------------------------------------------------------------------------- */
export async function build_query(db: Database | Transaction, query: StructuredQuery, user: any, role: string, structure: Structure, options: BuildWhereOptions = {}, before_values?: any | any[], after_values?: any | any[], result_values?: any | any[]) {
  /* -------------------------------------------------------------------------- */
  /*                              TABLE RETRIEVING                              */
  /* -------------------------------------------------------------------------- */
  const tableName = query.table;
  const tableStruct = structure[tableName];
  if (!tableStruct) throw new Error(`Table ${tableName} not found`);

  const query_type = query.type.toUpperCase()

  /* -------------------------------------------------------------------------- */
  /*                             ENDPOINT RETRIEVING                            */
  /* -------------------------------------------------------------------------- */
  const endpoint = tableStruct.endpoints.find((e: any) => e.type.toUpperCase() === query_type);
  if (!endpoint) throw new Error(`${query_type} not allowed on ${tableName}`);

  if (!endpoint[role]) {
    throw new Error(`Role '${role}' not allowed to perform ${query_type} on ${tableName}`);
  }

  /* -------------------------------------------------------------------------- */
  /*                                    ROLES                                   */
  /* -------------------------------------------------------------------------- */
  const rolePermissions = endpoint[role];
  if (typeof rolePermissions === "string" || Array.isArray(rolePermissions)) {
    throw new Error(`Invalid role permissions format for role '${role}'`);
  }

  const allowed =
    'allowed' in rolePermissions
      ? rolePermissions.allowed ?? []
      : 'allow' in rolePermissions
        ? rolePermissions.allow ?? []
        : [];

  const disallowed =
    'disallowed' in rolePermissions
      ? rolePermissions.disallowed ?? []
      : 'deny' in rolePermissions
        ? rolePermissions.deny ?? []
        : [];

  if (is_allowed_empty(allowed)) throw new Error("Not allowed");

  /* -------------------------------------------------------------------------- */
  /*               QUERY VALIDATION CHECK BEFORE RUNNING THE QUERY              */
  /* -------------------------------------------------------------------------- */

  const tableMap = extractTableMap(structure);

  const default_table = tableStruct.table
  const table_name = getTableName(default_table)

  const aclWhere = buildAclWhere(allowed, disallowed);

  let combinedWhere: WhereCondition | undefined;
  let query_where = query.where ? validate_where_fields(query.where, tableMap, table_name, structure, role, query_type) : query.where
  if (query_where && aclWhere) {
    combinedWhere = {
      and: [aclWhere, query_where]
    };
  } else if (query_where) {
    combinedWhere = query_where;
  } else if (aclWhere) {
    combinedWhere = aclWhere
  }

  if (combinedWhere && (typeof allowed != 'string' && !Array.isArray(allowed) || typeof disallowed != 'string' && !Array.isArray(disallowed))) {
    const has_been_accepted = await if_condition(db, combinedWhere, tableMap, user, role, structure, query, default_table)
    if (!has_been_accepted) throw new Error("Not allowed or Empty")
  }

  let limit = null
  if (query.limit) limit = query.limit

  if (rolePermissions.limit && (limit === null || limit > rolePermissions.limit)) {
    limit = rolePermissions.limit
  }

  /* -------------------------------------------------------------------------- */
  /*                           ALLOWED FIELDS RESOLVER                          */
  /* -------------------------------------------------------------------------- */

  const built_where = combinedWhere ? await buildWhere(db, combinedWhere!, tableMap, user, role, structure, query, default_table, table_name, undefined, before_values, after_values, result_values) : false

  let user_select_data_fields: Record<string, any> = {};

  if (query_type == "GET") {
    if ("select" in query && query.select) {
      user_select_data_fields = resolve_fields(structure, query.select, query_type, role, query.table, tableMap);
      user_select_data_fields = alias_selected_fields(user_select_data_fields);
    } else throw Error("Select is necessary on GET request")
  }
  if (query_type == "DELETE") {
    user_select_data_fields = resolve_fields(structure, "*", query_type, role, query.table, tableMap);
    user_select_data_fields = alias_selected_fields(user_select_data_fields);
  }
  if (query_type == "PUT" || query_type == "POST") {
    if ("data" in query && query.data) {
      user_select_data_fields = resolve_data(structure, user, query, query.data, query_type, role, query.table, tableMap, before_values, after_values, result_values);
      user_select_data_fields = stripPrefixes(user_select_data_fields);
    } else throw Error("Data is necessary on PUT/POST requests")
  }

  let result: any

  console.log(user_select_data_fields)

  let selected_data_fields: Record<string, any> | Array<Record<string, any>> =
      Array.isArray(user_select_data_fields)
        ? [...user_select_data_fields]
        : { ...user_select_data_fields };

  if (!Object.keys(selected_data_fields).length) {
    throw new Error("No allowed fields");
  }

  /* -------------------------------------------------------------------------- */
  /*                             TRIGGERS FILTERING                             */
  /* -------------------------------------------------------------------------- */

  const { before_triggers, after_triggers } = endpoint.triggers ? endpoint.triggers.reduce(
    (acc, trigger) => {
      if (trigger.type.toUpperCase() === 'AFTER') {
        if (acc.after_triggers) acc.after_triggers.push(trigger);
      } else if (trigger.type.toUpperCase() === 'BEFORE') {
        if (acc.before_triggers) acc.before_triggers.push(trigger);
      }
      return acc;
    },
    { before_triggers: [] as typeof endpoint.triggers, after_triggers: [] as typeof endpoint.triggers }
  ) : { before_triggers: null, after_triggers: null }

  const has_after_triggers = !options?.disable_triggers ? (after_triggers != null ? after_triggers.length != 0 : false) : false

  result = {
    execute: async () => {
      let before: any = null
      let after: any = null

      /* -------------------------------------------------------------------------- */
      /*                               QUERY EXECUTION                              */
      /* -------------------------------------------------------------------------- */

      let result = await db.transaction(async (tx: Transaction) => {

        /* -------------------------------------------------------------------------- */
        /*                               BEFORE TRIGGERS                              */
        /* -------------------------------------------------------------------------- */

        if (before_triggers && !options?.disable_triggers) selected_data_fields = await run_triggers(tx, options, query, user, role, structure, tableMap, tableStruct, user_select_data_fields, before_triggers, false)


        /* -------------------------------------------------------------------------- */
        /*                           RUN QUERY BASED ON TYPE                          */
        /* -------------------------------------------------------------------------- */

        let result

        switch (query_type.toUpperCase()) {
          case 'GET': {
            result = await get_method(tx, query, user, structure, rolePermissions, role, tableStruct, tableMap, selected_data_fields, built_where, tableName, limit)
            break;
          }
          case 'PUT': {
            if (has_after_triggers) before = await get_method(tx, query, user, structure, rolePermissions, role, tableStruct, tableMap, undefined, built_where, tableName, limit)
            const res = await put_method(tx, query, structure, rolePermissions, role, tableStruct, tableMap, selected_data_fields, built_where, tableName, limit, has_after_triggers)
            result = res.result;
            after = res.after;
            break;
          }
          case 'POST': {
            const res = await post_method(tx, query, structure, role, tableStruct, tableMap, selected_data_fields, tableName, has_after_triggers)
            result = res.result;
            after = res.after;
            break;
          }
          case 'DELETE': {
            if (has_after_triggers) before = await get_method(tx, query, user, structure, rolePermissions, role, tableStruct, tableMap, undefined, built_where, tableName, limit)
            result = await delete_method(tx, query, structure, rolePermissions, role, tableStruct, tableMap, built_where, tableName, limit)
            break;
          }
          default: {
            throw new Error("Invalid operation");
          }
        }

        /* -------------------------------------------------------------------------- */
        /*                               AFTER TRIGGERS                               */
        /* -------------------------------------------------------------------------- */
        if (after_triggers && has_after_triggers) await run_triggers(tx, options, query, user, role, structure, tableMap, tableStruct, user_select_data_fields, after_triggers, true, before, after, result)

        return result
      })

      return result
    }
  }

  return result
}

export type {
	Database,
	Transaction,
	Structure,
	TableStructure,
	BuildWhereOptions,
	SetCondition,
	SetValue,
	EndpointType,
	TriggerStructure,
	Endpoint,
	AllowedAliases,
	DisallowedAliases,
	Limit,
	OrderBy,
	GroupBy,
	Returning,
	RolePermissions,
	AllowedAliasesReturning,
	DisallowedAliasesReturning,
	FieldPermission,
	SafeOperator,
	CompileExecutionResult,
	ExecuteFunction,
	CompileResult,
	PhaseTypes,
	QueryPhase,
	Request,
	StructuredQuery,
	Join,
	OperatorAlias,
	SimpleCondition,
	BetweenCondition,
	NotBetweenCondition,
	ExistsCondition,
	NotExistsCondition,
	NotCondition,
	AndCondition,
	OrCondition,
	IfCondition,
	NestedCondition,
	WhereCondition,
	SubqueryCondition
} from "../types.js";

export default compile;
export { stripPrefixes } from "../rbac.js";