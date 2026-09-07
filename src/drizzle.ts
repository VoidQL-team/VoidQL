import { 
  eq, like, and, or, sql, ne, lt, lte, gt, gte, inArray,
  ilike,
  notIlike,
  isNull,
  isNotNull,
  exists,
  between,
  not,
  notLike,
  getTableName,
  notExists,
  notInArray,
  notBetween,
  getColumns
} from "drizzle-orm";
import { type Database, type WhereCondition, type StructuredQuery, type FieldPermission, type Structure, type TableStructure, type RolePermissions, type TriggerStructure, type BuildWhereOptions, type IfCondition, type ExistsCondition, type NotExistsCondition, type Returning, type Transaction, type SetCondition } from "./types.js";
import { alias_selected_fields, is_op_type, requests_data, resolve_fields, resolve_group_by_fields, resolve_order_by_fields, resolve_returning_fields, resolveCustomValue, toArray } from "./rbac.js";
import { build_query } from "./index.js";

/* -------------------------------------------------------------------------- */
/*                                 BUILD JOINS                                */
/* -------------------------------------------------------------------------- */

export async function buildJoin(db:Database | Transaction, q: any, joins: any[], tableMap: Record<string, any>, user: any, role:string, structure: Structure, query: StructuredQuery, default_table:any, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  for (const j of joins) {
    const joinStruct = tableMap[j.table];
    if (!joinStruct) throw new Error(`Table '${j.table}' not found in tableMap`);

    let joinCondition: any;

    // Support object with AND/OR inside 'on'
    if (j.on && j.on.type && (j.on.type.toUpperCase() === "AND" || j.on.type.toUpperCase() === "OR")) {
      // Complex condition
      joinCondition = await buildWhere(db, j.on, tableMap, user, role, structure, query, default_table, getTableName(default_table), undefined, before_values, after_values, result_values);
    } else {
      // Simple key-value mapping
      const conditions: any[] = [];
      for (const leftKey in j.on) {
        const rightKey = j.on[leftKey];
        const [lTbl, lCol] = leftKey.split(".");
        const [rTbl, rCol] = rightKey.split(".");

        const l = tableMap[lTbl]?.[lCol];
        const r = tableMap[rTbl]?.[rCol];

        if (!l || !r) throw new Error(`Invalid join keys: ${leftKey} -> ${rightKey}`);
        conditions.push(eq(l, r));
      }

      // If multiple conditions, combine with AND
      joinCondition = conditions.length > 1 ? and(...conditions) : conditions[0];
    }

    const joinTable = tableMap[j.table];
    if (!joinTable) throw new Error(`Join table '${j.table}' not found in tableMap`);

    // Apply the join type
    if (j.type.toUpperCase() === "INNER") q.innerJoin(joinTable, joinCondition);
    else if (j.type.toUpperCase() === "LEFT") q.leftJoin(joinTable, joinCondition);
    else throw new Error(`Unsupported join type: ${j.type}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                               MAIN CONDITIONS                              */
/* -------------------------------------------------------------------------- */

async function and_condition(parts:any[]) { 
  const is_one_boolean = parts.some(part => typeof part == "boolean")
  if(is_one_boolean) {
    const has_false = parts.some(part => typeof part === "boolean" && part === false)
    if(has_false) return sql`false`
    else {
      parts = parts.filter(part => !(typeof part === "boolean" && part === true))
      console.log('PARTS: ', parts)
      if(parts.length == 1) return sql`${parts}`;
    }
  }
  return and(...parts);
}

async function or_condition(parts: any[]) {
  const is_one_boolean = parts.some(part => typeof part == "boolean")
  if(is_one_boolean) {
    const has_true = parts.some(part => typeof part === "boolean" && part === true)
    if(has_true) return sql`true`
  }
  return or(...parts);
} 

async function if_conditions(db: Database | Transaction, cond: IfCondition, tableMap: Record<string, any>, user: any, role: string, structure: Structure, query: StructuredQuery, default_table:any, default_table_name: string, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  let condition:any = sql``
  const when_condition = await if_condition(db, cond.if.when, tableMap, user, role, structure, query, default_table)
  if(cond.if != undefined &&"do" in cond.if) {
    if(when_condition) {
      let do_condition
      if(typeof cond.if.do == 'function') throw Error('Function not allowed in where condition')
      if(typeof cond.if.do == 'object') {
        if(cond.if.do != undefined && ("type" in cond.if.do)) throw Error('Structured Query not allowed in where condition')
        else do_condition = await buildWhere(db, cond.if.do, tableMap, user, role, structure, query, default_table, default_table_name, undefined, before_values, after_values, result_values)
      }
      else if(typeof cond.if.do == 'boolean') return cond.if.do
      else if(cond.if.do) do_condition = sql`${cond.if.do}`

      condition.append(do_condition)
    }
    else if("else" in cond.if) {
      let else_condition
      if(typeof cond.if.else == 'function') throw Error('Function not allowed in where condition')
      if(typeof cond.if.else == 'object') {
        if(cond.if.else != undefined && ("type" in cond.if.else)) throw Error('Structured Query not allowed in where condition')
        else else_condition = await buildWhere(db, cond.if.else, tableMap, user, role, structure, query, default_table, default_table_name, undefined, before_values, after_values, result_values)
      }
      else if(typeof cond.if.else == 'boolean') return cond.if.else
      else if(cond.if.else) else_condition = sql`${cond.if.else}`
        
      condition.append(else_condition)
    }
  }
  return condition
}

async function exists_condition(db: Database | Transaction, cond: ExistsCondition, tableMap: Record<string, any>, user: any, role: string, structure: Structure, query: StructuredQuery, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  let subTable = null
  let fields:any = null
  let subWhere = null
  const sub_query = cond.query
  if(sub_query) {
    subTable = tableMap[sub_query.from];
    if (!subTable) throw new Error(`Table '${sub_query.from}' not found`);
    fields = resolve_fields(structure, sub_query.select, 'GET', role, sub_query.from, tableMap);
    fields = alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    subWhere = sub_query.where
      ? await buildWhere(db, sub_query.where, tableMap, user, role, structure, query, subTable, getTableName(subTable), undefined, before_values, after_values, result_values)
      : undefined;
  }
  let inner_query = db.select(fields).from(subTable)
  if(subWhere) {
    inner_query = inner_query.where(subWhere)
  }
  return exists(inner_query);
}

async function not_exists_condition(db: Database | Transaction, cond: NotExistsCondition, tableMap: Record<string, any>, user: any, role: string, structure: Structure, query: StructuredQuery, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  let subTable = null
  let fields:any = null
  let subWhere = null
  const sub_query = cond.query
  if(sub_query) {
    subTable = tableMap[sub_query.from];
    if (!subTable) throw new Error(`Table '${sub_query.from}' not found`);
    fields = resolve_fields(structure, sub_query.select, 'GET', role, sub_query.from, tableMap);
    fields = alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    subWhere = sub_query.where
      ? await buildWhere(db, sub_query.where, tableMap, user, role, structure, query, subTable, getTableName(subTable), undefined, before_values, after_values, result_values)
      : undefined;
  }
  let inner_query = db.select(fields).from(subTable)
  if(subWhere) {
    inner_query = inner_query.where(subWhere)
  }
  return notExists(inner_query);
}

async function in_condition(db: Database | Transaction, left:any, right: any, tableMap: Record<string, any>, user: any, role: string, structure: Structure, query: StructuredQuery, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  if (right != undefined && typeof right === "object" && "select" in right) {
    const subTable = tableMap[right.from];
    if (!subTable) throw new Error(`Table '${right.from}' not found`);
    let fields = resolve_fields(structure, right.select, 'GET', role, right.from, tableMap);
    fields = alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    const subWhere = right.where
      ? await buildWhere(db, right.where, tableMap, user, role, structure, query, subTable, getTableName(subTable), undefined, before_values, after_values, result_values)
      : undefined;
    let inner_query = db.select(fields).from(subTable)
    if(subWhere) {
      inner_query = inner_query.where(subWhere)
    }
    return inArray(left, inner_query);
  }
  // Normal IN array
  if (Array.isArray(right)) return inArray(left, right);
  throw Error('Wrong values for in condition')
}

async function not_in_condition(db: Database | Transaction, left:any, right: any, tableMap: Record<string, any>, user: any, role: string, structure: Structure, query: StructuredQuery, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  if (right != undefined && typeof right === "object" && "select" in right) {
      const subTable = tableMap[right.from];
      if (!subTable) throw new Error(`Table '${right.from}' not found`);
      let fields = resolve_fields(structure, right.select, 'GET', role, right.from, tableMap);
      fields = alias_selected_fields(fields);
      if(!fields) throw new Error(`Inner fields not found`);
      const subWhere = right.where
        ? await buildWhere(db, right.where, tableMap, user, role, structure, query, subTable, getTableName(subTable), undefined, before_values, after_values, result_values)
        : undefined;
      let inner_query = db.select(fields).from(subTable)
      if(subWhere) {
        inner_query = inner_query.where(subWhere)
      }
      return notInArray(left, inner_query);
    }
    // Normal NOT IN array
    if (Array.isArray(right)) return notInArray(left, right);
  throw Error('Wrong values for not in condition')
}

function check_passed(cond: WhereCondition, value: any) {
  if (typeof cond === 'boolean') return null

  if (
    cond &&
    ('op' in cond || 'operator' in cond) &&
    (is_op_type(cond, "IS PASSED") || is_op_type(cond, "IS NOT PASSED"))
  ) {
    const passed = value !== undefined

    if (is_op_type(cond, "IS PASSED")) {
      return sql`${passed}`
    }

    if (is_op_type(cond, "IS NOT PASSED")) {
      return sql`${!passed}`
    }
  }

  return null
}

function sanitize_undefined(value:any) {
  if(value == undefined) return null
  return value
}

/* -------------------------------------------------------------------------- */
/*                                WHERE BUILDER                               */
/* -------------------------------------------------------------------------- */

export async function buildWhere(db: Database | Transaction, cond: WhereCondition, tableMap: Record<string, any>, user: any, role: string, structure: Structure, query: StructuredQuery, default_table:any, default_table_name: string, custom_data?:Record<string, any>, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]): Promise<any> {
  // Nested AND/OR
  if(typeof cond == 'boolean') return cond
  if(cond == undefined) return
  if ("and" in cond && cond.and) {
    let parts = await Promise.all(
      cond.and.map((c) =>
        buildWhere(db, c, tableMap, user, role, structure, query, default_table, default_table_name, undefined, before_values, after_values, result_values)
      )
    );
    return await and_condition(parts)
  }
  else if ("or" in cond && cond.or) {
    let parts = await Promise.all(
      cond.or.map((c) =>
        buildWhere(db, c, tableMap, user, role, structure, query, default_table, default_table_name, undefined, before_values, after_values, result_values)
      )
    );
    return await or_condition(parts)
  }
  else if('if' in cond && cond.if && "when" in cond.if && cond.if.when != undefined) {
    return await if_conditions(db, cond, tableMap, user, role, structure, query, default_table, default_table_name, before_values, after_values, result_values)
  }else if('not' in cond && cond.not != undefined) {
    return not(await buildWhere(db, cond.not, tableMap, user, role, structure, query, default_table, default_table_name, undefined, before_values, after_values, result_values))
  }

  if (cond && ('op' in cond || 'operator' in cond) && is_op_type(cond, "EXISTS") && 'query' in cond) {
    return await exists_condition(db, cond, tableMap, user, role, structure, query, before_values, after_values, result_values)
  }

  if (cond && ('op' in cond || 'operator' in cond) && is_op_type(cond, "NOT EXISTS") && 'query' in cond) {
    return await not_exists_condition(db, cond, tableMap, user, role, structure, query, before_values, after_values, result_values)
  }

  // Determine left side
  let left: any;
  let right: any;

  let start: any
  let end: any

  if(!custom_data && !('if' in cond ) && requests_data(cond, 'before') && before_values && Array.isArray(before_values)) {
    //AND CONDITION AND PASS CUSTOM DATA FOR EACH OF THE ARRAY
    let parts = await Promise.all(
      before_values.map((custom_data) =>
        buildWhere(db, cond, tableMap, user, role, structure, query, default_table, default_table_name, custom_data, before_values, after_values, result_values)
      )
    );
    return await and_condition(parts)
  }else if(!custom_data && !('if' in cond ) && requests_data(cond, 'after') && after_values && Array.isArray(after_values)) {
    //AND CONDITION AND PASS CUSTOM DATA FOR EACH OF THE ARRAY
    let parts = await Promise.all(
      after_values.map((custom_data) =>
        buildWhere(db, cond, tableMap, user, role, structure, query, default_table, default_table_name, custom_data, before_values, after_values, result_values)
      )
    );
    return await and_condition(parts)
  }else if(!custom_data && !('if' in cond ) && requests_data(cond, 'result') && result_values && Array.isArray(result_values)) {
    //AND CONDITION AND PASS CUSTOM DATA FOR EACH OF THE ARRAY
    let parts = await Promise.all(
      result_values.map((custom_data) =>
        buildWhere(db, cond, tableMap, user, role, structure, query, default_table, default_table_name, custom_data, before_values, after_values, result_values)
      )
    );
    return await and_condition(parts)
  }else if(!custom_data && !('if' in cond ) && requests_data(cond, 'data') && query.data && Array.isArray(query.data)) {
    //AND CONDITION AND PASS CUSTOM DATA FOR EACH OF THE ARRAY
    let parts = await Promise.all(
      query.data.map((custom_data) =>
        buildWhere(db, cond, tableMap, user, role, structure, query, default_table, default_table_name, custom_data, before_values, after_values, result_values)
      )
    );
    return await and_condition(parts)
  }

  if ("left_value" in cond) {
    const left_value = resolveCustomValue(cond.left_value, user, query, tableMap, default_table_name, custom_data)
    const passed = check_passed(cond, left_value)
    if(passed != null) return passed
    left = sql`${sanitize_undefined(left_value)}`;
  } else if ("field" in cond && cond.field) {
    let tbl, col;
    if(cond.field.includes(".")) {
      [tbl, col] = cond.field.split(".");
    }else {
      col = cond.field;
      tbl = default_table_name;
    }
    const column = tableMap[tbl]?.[col];
    if (!column) throw new Error(`Column '${cond.field}' not found`);
    left = column;
  } else if("value" in cond) {
    const value = resolveCustomValue(cond.value, user, query, tableMap, default_table_name, custom_data)
    const passed = check_passed(cond, value)
    if(passed != null) return passed
    left = sql`${sanitize_undefined(value)}`;
  } else {
    console.log(cond)
    throw new Error("Condition must have 'field' or 'left_value' or 'value");
  }

  if ("value" in cond) {
    const right_value = resolveCustomValue(cond.value, user, query, tableMap, default_table_name, custom_data)
    const passed = check_passed(cond, right_value)
    if(passed != null) return passed
    right = sql`${sanitize_undefined(right_value)}`;
  }
  
  if("start" in cond && "end" in cond && is_op_type(cond, "BETWEEN")) {
    const start_value = resolveCustomValue(cond.start, user, query, tableMap, default_table_name, custom_data)
    const start_passed = check_passed(cond, start_value)
    if(start_passed != null) return start_passed
    start = sql`${sanitize_undefined(start_value)}`;
    const end_value = resolveCustomValue(cond.end, user, query, tableMap, default_table_name, custom_data)
    const end_passed = check_passed(cond, end_value)
    if(end_passed != null) return end_passed
    end = sql`${sanitize_undefined(end_value)}`;
  } else if(("start" in cond || "end" in cond)) {
    throw new Error("'start' or 'end' fields must have a compatible operator");
  } else if(is_op_type(cond, "BETWEEN") && !("start" in cond && "end" in cond)) {
    throw new Error("Between operator must have 'start' and 'end' fields");
  }

  // Subquery IN
  if(is_op_type(cond, "IN") && (left != null && left !=undefined)) {
    return await in_condition(db, left, right, tableMap, user, role, structure, query, before_values, after_values, result_values)
  }else if(is_op_type(cond, "IN")) {
    return sql`false`
  }

  if(is_op_type(cond, "NOT IN") && (left != null && left !=undefined)) {
    return await not_in_condition(db, left, right, tableMap, user, role, structure, query, before_values, after_values, result_values)
  }else if(is_op_type(cond, "NOT IN")) {
    return sql`false`
  }

  const operator = cond.operator ?? cond.op

  // Literal operators
  if(operator) {
    switch (operator.toUpperCase()) {
      case "=": {
        if(right == null) return isNull(left)
        else return eq(left, right)
      };
      case "!=": {
        if(right == null) return isNull(left)
        else return ne(left, right)
      };
      case "<": return lt(left, right);
      case "<=": return lte(left, right);
      case ">": return gt(left, right);
      case ">=": return gte(left, right);
      case "LIKE": return like(left, right);
      case "NOT LIKE": return notLike(left, right);
      case "ILIKE": return ilike(left, right);
      case "NOT ILIKE": return notIlike(left, right);
      case "IS": {
        if(right == null) return isNull(left)
        else throw new Error(`Unsupported operator: ${operator}`);
      };
      case "IS NOT": {
        if(right == null) return isNotNull(left)
        else throw new Error(`Unsupported operator: ${operator}`);
      };
      case "IS NULL": return isNull(left);
      case "IS NOT NULL": return isNotNull(left);
      case "BETWEEN": {
        return between(left, start, end)
      }
      case "NOT BETWEEN": {
        return notBetween(left, start, end)
      }
    }
  }
  throw new Error(`Unsupported operator: ${operator}`);
}

/* -------------------------------------------------------------------------- */
/*                                 ACL BUILDER                                */
/* -------------------------------------------------------------------------- */

export function buildAclWhere(allowed: FieldPermission, disallowed: FieldPermission): WhereCondition | null {
  // Start with undefined
  let aclWhere: WhereCondition | null = null;

  function injectIfExists(obj: any) {
     return obj && obj.where ? (obj.where as WhereCondition) : undefined;
  }
  
  const allowedWhere = injectIfExists(allowed);
  const disallowedWhere = injectIfExists(disallowed);

  if (allowedWhere && disallowedWhere) {
    aclWhere = {
      and: [
        allowedWhere,
        {
          not: disallowedWhere
        }
      ],
    };
  } else if (allowedWhere) {
    aclWhere = allowedWhere;
  } else if (disallowedWhere) {
    aclWhere = {
      not: disallowedWhere
    };
  }

  return aclWhere;
}

/* -------------------------------------------------------------------------- */
/*                      IF CONDITION TO VALIDATE QUERIES                      */
/* -------------------------------------------------------------------------- */

export async function if_condition(db:Database | Transaction, where_condtion:WhereCondition, table_map:any, user:any, role: string, structure: Structure, query:StructuredQuery, default_table:any, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]):Promise<boolean> {
  if(typeof where_condtion == "boolean") {
    return where_condtion
  }
  let where = await buildWhere(db, where_condtion, table_map, user, role, structure, query, default_table, getTableName(default_table), undefined, before_values, after_values, result_values);

  // Start empty SQL object
  const need_table:boolean = query.join ? true : has_field_or_col_attribute(where_condtion)
  
  const check_query = sql<number>`
    COALESCE(
      MAX(
        CASE WHEN ${where} THEN 1 ELSE 0 END
      ),
      0
    ) AS result
  `;

  const from_table = need_table ? default_table : sql`(select 1) AS t`

  const builded_query = db.select({
    result: check_query
  }).from(from_table)

  if(query.join) await buildJoin(db, builded_query, query.join, table_map, user, role, structure, query, from_table, before_values, after_values, result_values)

  builded_query.limit(1)
  console.log(builded_query.toSQL().sql, builded_query.toSQL().params)
  const [rows]: any = await builded_query.execute()

  console.log(rows)
  const result = rows.result ?? 0;

  // Return as boolean
  return Boolean(result);
}

/* -------------------------------------------------------------------------- */
/*         CHECK IF HAS FIELD OR COL TO ADD OR NOT TABLE TO CONDITION         */
/* -------------------------------------------------------------------------- */

export function has_field_or_col_attribute(
  input: any,
  insideFrom: boolean = false
): boolean {
  if (input === null || typeof input !== 'object') {
    return false;
  }

  if (Array.isArray(input)) {
    return input.some(item => has_field_or_col_attribute(item, insideFrom));
  }

  // If this object defines a FROM clause, everything below it is insideFrom
  const isFromScope = insideFrom || Object.prototype.hasOwnProperty.call(input, 'from');

  // Only count field / $col if NOT inside a from-scope
  if (
    !isFromScope &&
    (Object.prototype.hasOwnProperty.call(input, 'field') ||
     Object.prototype.hasOwnProperty.call(input, '$col'))
  ) {
    return true;
  }

  return Object.values(input).some(value =>
    has_field_or_col_attribute(value, isFromScope)
  );
}

export function is_allowed_empty(allowed: FieldPermission) {
  if(Array.isArray(allowed) && allowed.length == 0) return true
  else if(!allowed) return true
  else if(allowed == '') return true
  else if(typeof allowed == 'object' && !Array.isArray(allowed) && allowed.field) {
    return is_allowed_empty(allowed.field)
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                           ENDPOINT QUERY METHODS                           */
/* -------------------------------------------------------------------------- */

export async function get_method(db: Database | Transaction, query: StructuredQuery, user:string, structure:Structure, rolePermissions:RolePermissions, role:string, tableStruct:TableStructure, tableMap: Record<string, any>, selected_data_fields: Record<string, any> | undefined, built_where:any, tableName:string, limit:any, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  const q = db.select(selected_data_fields).from(tableStruct.table);

  if (query.join) await buildJoin(db, q, query.join, tableMap, user, role, structure, query, tableStruct.table, before_values, after_values, result_values);

  if (built_where) q.where(built_where);

  const groupByFields =
    resolve_group_by_fields(structure, toArray(query.group_by), query.type, role, tableName, tableMap) ??
    toArray(rolePermissions?.group_by) ??
    [];

  if (groupByFields.length > 0) {
    q.groupBy(...groupByFields);
  }

  const orderByFields =
    resolve_order_by_fields(structure, toArray(query.order_by), query.type, role, tableName, tableMap) ??
    toArray(rolePermissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    q.orderBy(...orderByFields);
  }

  if(limit != null) q.limit(limit)

  const rows = await q.execute();
  return rows;
}

export async function put_method(db: Database | Transaction, query: StructuredQuery, structure:Structure, rolePermissions:RolePermissions, role:string, tableStruct:TableStructure, tableMap: Record<string, any>, selected_data_fields: Record<string, any>, built_where:any, tableName:string, limit:any, has_after_triggers:boolean) {
  if (!query.data) throw new Error("PUT requires data");

  const update_query = db.update(tableStruct.table).set(selected_data_fields)
  
  if(built_where) {
    update_query.where(built_where)
  }

  const orderByFields =
    resolve_order_by_fields(structure, toArray(query.order_by), query.type, role, tableName, tableMap) ??
    toArray(rolePermissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    update_query.orderBy(...orderByFields);
  }

  if(limit != null) update_query.limit(limit)

  let after_function:any = null;
    
  if(query.returning || has_after_triggers) {
    let fields = getColumns(tableStruct.table)
    if (typeof update_query.returning === 'function') {
      update_query.returning(fields);
    }else if (typeof update_query.$returningId === 'function') {
      update_query.$returningId(fields);
      after_function = async (result:any) => {
        if(!result) return
        const fieldName = Object.keys(result[0])[0];
        const values = result.map((obj:any) => Object.values(obj)[0]);
        const after = await db.select().from(tableStruct.table).where(inArray(tableStruct.table[fieldName], values)).execute()
        return after
      }
    }else if (typeof update_query.output === 'function') {
      update_query.output(fields);
    }
  }

  console.log(update_query.toSQL().sql, update_query.toSQL().params)
    
  let result = await update_query.execute();

  let after: any = null;

  if (query.returning || has_after_triggers) {
    if (after_function) {
      after = await after_function(result);
    } else {
      after = result
    }
    if(query.returning) {
      const allowedFields = Object.keys(
        resolve_returning_fields(
          structure,
          query.returning,
          query.type,
          role,
          tableName,
          tableMap
        )
      );

      result =
        allowedFields.length === 0
          ? []
          : after.map((row: Record<string, any>) => {
              const filtered: Record<string, any> = {};

              for (const field of allowedFields) {
                if (row != undefined && field in row) {
                  filtered[field] = row[field];
                }
              }

              return filtered;
            });
    }else result = []
  }

  return { result, after };
}

export async function post_method(db: Database | Transaction, query: StructuredQuery, structure:Structure, role:string, tableStruct:TableStructure, tableMap: Record<string, any>, selected_data_fields: Record<string, any>, tableName:string, has_after_triggers:boolean) {
  if (!query.data) throw new Error("POST requires data");

  const post_query = db
    .insert(tableStruct.table)
    .values(selected_data_fields);
  
  let after_function:any = null;
    
  if(query.returning || has_after_triggers) {
    let fields = getColumns(tableStruct.table)
    if (typeof post_query.returning === 'function') {
      post_query.returning(fields);
    }else if (typeof post_query.$returningId === 'function') {
      post_query.$returningId(fields);
      after_function = async (result:any) => {
        if(!result) return
        const fieldName = Object.keys(result[0])[0];
        const values = result.map((obj:any) => Object.values(obj)[0]);
        const after = await db.select().from(tableStruct.table).where(inArray(tableStruct.table[fieldName], values)).execute()
        return after
      }
    }else if (typeof post_query.output === 'function') {
      post_query.output(fields);
    }
  }
    
  let result = await post_query.execute();

  let after: any = null;

  if (query.returning || has_after_triggers) {
    if (after_function) {
      after = await after_function(result);
    } else {
      after = result
    }
    if(query.returning) {
      const allowedFields = Object.keys(
        resolve_returning_fields(
          structure,
          query.returning,
          query.type,
          role,
          tableName,
          tableMap
        )
      );

      result =
        allowedFields.length === 0
          ? []
          : after.map((row: Record<string, any>) => {
              const filtered: Record<string, any> = {};

              for (const field of allowedFields) {
                if (row != undefined && field in row) {
                  filtered[field] = row[field];
                }
              }

              return filtered;
            });
    }else result = []
  }

  return { result, after };
}

export async function delete_method(db: Database | Transaction, query: StructuredQuery, structure:Structure, rolePermissions:RolePermissions, role:string, tableStruct:TableStructure, tableMap: Record<string, any>, built_where:any, tableName:string, limit:any){
  const delete_query = db.delete(tableStruct.table);
  
  if(built_where) {
    delete_query.where(built_where);
  }

  const orderByFields =
    resolve_order_by_fields(structure, toArray(query.order_by), query.type, role, tableName, tableMap) ??
    toArray(rolePermissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    delete_query.orderBy(...orderByFields);
  }

  if(limit != null) delete_query.limit(limit)

  if(query.returning) {
    let fields = resolve_returning_fields(structure, query.returning, query.type, role, tableName, tableMap)
    fields = alias_selected_fields(fields)
    if (Object.keys(fields).length === 0) {
      throw new Error("No valid returning fields allowed");
    }
    if (typeof delete_query.returning === 'function') {
      delete_query.returning(fields);
    }else if (typeof delete_query.output === 'function') {
      delete_query.output(fields);
    }
  }
  
  let result = await delete_query.execute();

  return result;
}

/* -------------------------------------------------------------------------- */
/*                               TRIGGERS RUNNER                              */
/* -------------------------------------------------------------------------- */

export async function run_triggers(db: Database | Transaction, options:BuildWhereOptions, query: StructuredQuery, user: any, role:string, structure: Structure, tableMap: Record<string, any>, tableStruct:TableStructure, selected_data_fields: Record<string, any>, triggers:TriggerStructure[], after:boolean = false, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  for(let trigger of triggers) {
    if(trigger.query != undefined && "if" in trigger.query) {
      const condition = trigger.query.if
      const when_condition = await if_condition(db, condition.when, tableMap, user, role, structure, query, tableStruct.table)
      if(when_condition && condition.do) {
        if(typeof condition.do == "function" && "type" in condition.do) {
          const params = {
            before: before_values,
            after: after_values,
            result: result_values
          }
          await condition.do(params);
        }else if(typeof condition.do == "object" && "type" in condition.do) {
          try{
            await (await build_query(db, condition.do, user, role, structure, {
              disable_triggers: true,
              ...options
            }, before_values, after_values, result_values)).execute()
          }catch(err) {
            throw err;
          }
        }
      }else if(!when_condition && condition.else) {
        if(typeof condition.else == "function" && "type" in condition.else) {
          const params = {
            before: before_values,
            after: after_values,
            result: result_values
          }
          await condition.else(params);
        }else if(typeof condition.else == "object" && "type" in condition.else) {
          try{
            await (await build_query(db, condition.else, user, role, structure, {
              disable_triggers: true,
              ...options
            }, before_values, after_values, result_values)).execute()
          }catch(err) {
            throw err
          }
        }
      }
    }
    if (trigger.query != undefined && "set" in trigger.query) {
      if (after) {
        console.log('Set not available in after queries')
        continue
      }

      function set_value(
        set: SetCondition,
        where: WhereCondition,
        table_name: string,
        i?: number,
        custom_value?: any
      ) {
        if(!set) return
        const value = sql`${resolveCustomValue(
          set.value,
          user,
          query,
          tableMap,
          table_name,
          custom_value
        )}`

        let fallback_value;

        if ("else_value" in set) {
          fallback_value = sql`${resolveCustomValue(
            set.else_value,
            user,
            query,
            tableMap,
            table_name,
            custom_value
          )}`
        } else {
          const existing =
            typeof i === "number"
              ? selected_data_fields?.[i]?.[set.field]
              : selected_data_fields?.[set.field];

          fallback_value = existing ?? sql`COALESCE(${value}, '')`;
        }

        console.log("SETTING:", set.field, "ROW:", i ?? "single");

        const target =
          typeof i === "number"
            ? selected_data_fields[i]
            : selected_data_fields;

        target[set.field] = sql`
          CASE 
            WHEN ${where} THEN ${value}
            ELSE ${fallback_value}
          END
        `;
      }

      const set = trigger.query.set
      const table_name = getTableName(tableStruct.table)

      const where = await buildWhere(
        db,
        set.when,
        tableMap,
        user,
        role,
        structure,
        query,
        tableStruct.table,
        table_name
      )

      if (query.data && Array.isArray(query.data)) {
        // ensure container exists
        if (!Array.isArray(selected_data_fields)) {
          selected_data_fields = [];
        }

        for (let i = 0; i < query.data.length; i++) {
          if (!selected_data_fields[i]) {
            selected_data_fields[i] = {};
          }

          set_value(set, where, table_name, i, query.data[i]);
        }
      }else set_value(set, where, table_name);
    }
    if(trigger.query != undefined && "type" in trigger.query) {
      try{
        await (await build_query(db, trigger.query, user, role, structure, {
          disable_triggers: true,
          ...options
        }, before_values, after_values, result_values)).execute()
      }catch(err) {
        throw err;
      }
    }
  }
  return selected_data_fields
}
