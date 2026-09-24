import { Compiler } from "./index.js";
import { ExistsCondition, FieldPermission, IfCondition, NotExistsCondition, WhereCondition } from "../types.js";
import { and, between, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, like, lt, lte, ne, not, notBetween, notExists, notIlike, notInArray, notLike, or, SQL, sql } from "drizzle-orm";
import { alias_selected_fields, is_op_type, requests_data, resolve_fields, resolveCustomValue, validate_where_fields } from "../rbac.js";
import { has_field_or_col_attribute } from "../drizzle.js";

declare module "./index.js" {
    interface Compiler {
        build_where(cond: WhereCondition, custom_data?:Record<string, any>): any;
        and(conditions:any[]): any;
        or(conditions:any[]): any;
        if(condition: IfCondition): any;
        exists(condition: ExistsCondition): any;
        not_exists(condition: NotExistsCondition): any;
        in_condition(left:any, right:any): any;
        not_in_condition(left:any, right:any): any;
        check_passed(cond: WhereCondition, value:any): SQL | null;
        sanitize_undefined(value:any): null | any;
        build_acl_where(allowed:FieldPermission, disallowed:FieldPermission): WhereCondition | null;
        compile_policy(): void;
        validate_policy(): Promise<void>
        define_where(allowed:FieldPermission, disallowed:FieldPermission): void;
        is_allowed_empty(allowed: FieldPermission): boolean;
    }
}

/* -------------------------------------------------------------------------- */
/*                                WHERE BUILDER                               */
/* -------------------------------------------------------------------------- */

Compiler.prototype.build_where = function(cond: WhereCondition, custom_data?:Record<string, any>): any {
  if(cond == undefined) return
  if(typeof cond == 'boolean') return cond
  
  if ("and" in cond && cond.and) {
    const parts = cond.and.map(c =>
      this.build_where(c)
    );

    return this.and(parts);
  }
  else if ("or" in cond && cond.or) {
    const parts = cond.or.map(c =>
      this.build_where(c)
    );

    return this.or(parts);
  }
  else if('if' in cond && cond.if && "when" in cond.if && cond.if.when != undefined) {
    return this.if(cond)
  }else if('not' in cond && cond.not != undefined) {
    return not(this.build_where(cond.not))
  }

  if (cond && ('op' in cond || 'operator' in cond) && is_op_type(cond, "EXISTS") && 'query' in cond) {
    return this.exists(cond)
  }

  if (cond && ('op' in cond || 'operator' in cond) && is_op_type(cond, "NOT EXISTS") && 'query' in cond) {
    return this.not_exists(cond)
  }

  // Determine left side
  let left: any;
  let right: any;

  let start: any
  let end: any

  if (
    !custom_data &&
    !("if" in cond) &&
    requests_data(cond, "before") &&
    this.before_values &&
    Array.isArray(this.before_values)
  ) {
    const parts = this.before_values.map(custom_data =>
      this.build_where(cond, custom_data)
    );

    return this.and(parts);

  } else if (
    !custom_data &&
    !("if" in cond) &&
    requests_data(cond, "after") &&
    this.after_values &&
    Array.isArray(this.after_values)
  ) {
    const parts = this.after_values.map(custom_data =>
      this.build_where(cond, custom_data)
    );

    return this.and(parts);

  } else if (
    !custom_data &&
    !("if" in cond) &&
    requests_data(cond, "result") &&
    this.result_values &&
    Array.isArray(this.result_values)
  ) {
    const parts = this.result_values.map(custom_data =>
      this.build_where(cond, custom_data)
    );

    return this.and(parts);

  } else if (
    !custom_data &&
    !("if" in cond) &&
    requests_data(cond, "data") &&
    this.data &&
    Array.isArray(this.data)
  ) {
    const parts = this.data.map(custom_data =>
      this.build_where(cond, custom_data)
    );

    return this.and(parts);
  }

  if ("left_value" in cond) {
    const left_value = resolveCustomValue(cond.left_value, this.user, this.query, this.table_map, this.table_name, custom_data)
    const passed = this.check_passed(cond, left_value)
    if(passed != null) return passed
    left = sql`${this.sanitize_undefined(left_value)}`;
  } else if ("field" in cond && cond.field) {
    let tbl, col;
    if(cond.field.includes(".")) {
      [tbl, col] = cond.field.split(".");
    }else {
      col = cond.field;
      tbl = this.table_name;
    }
    const column = this.table_map[tbl]?.[col];
    if (!column) throw new Error(`Column '${cond.field}' not found`);
    left = column;
  } else if("value" in cond) {
    const value = resolveCustomValue(cond.value, this.user, this.query, this.table_map, this.table_name, custom_data)
    const passed = this.check_passed(cond, value)
    if(passed != null) return passed
    left = sql`${this.sanitize_undefined(value)}`;
  } else {
    console.log(cond)
    throw new Error("Condition must have 'field' or 'left_value' or 'value");
  }

  if ("value" in cond) {
    const right_value = resolveCustomValue(cond.value, this.user, this.query, this.table_map, this.table_name, custom_data)
    const passed = this.check_passed(cond, right_value)
    if(passed != null) return passed
    right = sql`${this.sanitize_undefined(right_value)}`;
  }
  
  if("start" in cond && "end" in cond && is_op_type(cond, "BETWEEN")) {
    const start_value = resolveCustomValue(cond.start, this.user, this.query, this.table_map, this.table_name, custom_data)
    const start_passed = this.check_passed(cond, start_value)
    if(start_passed != null) return start_passed
    start = sql`${this.sanitize_undefined(start_value)}`;
    const end_value = resolveCustomValue(cond.end, this.user, this.query, this.table_map, this.table_name, custom_data)
    const end_passed = this.check_passed(cond, end_value)
    if(end_passed != null) return end_passed
    end = sql`${this.sanitize_undefined(end_value)}`;
  } else if(("start" in cond || "end" in cond)) {
    throw new Error("'start' or 'end' fields must have a compatible operator");
  } else if(is_op_type(cond, "BETWEEN") && !("start" in cond && "end" in cond)) {
    throw new Error("Between operator must have 'start' and 'end' fields");
  }

  // Subquery IN
  if(is_op_type(cond, "IN") && (left != null && left !=undefined)) {
    return this.in_condition(left, right)
  }else if(is_op_type(cond, "IN")) {
    return sql`false`
  }

  if(is_op_type(cond, "NOT IN") && (left != null && left !=undefined)) {
    return this.not_in_condition(left, right)
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
};

Compiler.prototype.and = function(conditions:any[]) { 
    const is_one_boolean = conditions.some(cond => typeof cond == "boolean")
    if(is_one_boolean) {
        const has_false = conditions.some(cond => typeof cond === "boolean" && cond === false)
        if(has_false) return sql`false`
        else {
            conditions = conditions.filter(cond => !(typeof cond === "boolean" && cond === true))
            if(conditions.length == 1) return sql`${conditions[0]}`;
        }
    }
    return and(...conditions);
}

Compiler.prototype.or = function(conditions: any[]) {
  const is_one_boolean = conditions.some(cond => typeof cond == "boolean")
  if(is_one_boolean) {
    const has_true = conditions.some(cond => typeof cond === "boolean" && cond === true)
    if(has_true) return sql`true`
  }
  return or(...conditions);
}

Compiler.prototype.if = function(cond: IfCondition) {
  const build_branch = (branch: IfCondition["if"]["do"] | IfCondition["if"]["else"]) => {
    if (typeof branch === "function") {
      throw new Error("Function not allowed in where condition");
    }

    if (branch && typeof branch === "object" && "type" in branch) {
      throw new Error("Structured Query not allowed in where condition");
    }

    const value = branch === undefined ? false : this.build_where(branch);
    return typeof value === "boolean" ? sql`${value}` : value;
  };

  const when_condition = this.build_where(cond.if.when);
  const do_condition = build_branch(cond.if.do);
  const else_condition = build_branch(cond.if.else);

  return sql<boolean>`CASE WHEN ${when_condition} THEN ${do_condition} ELSE ${else_condition} END`;
}

Compiler.prototype.exists = function(cond: ExistsCondition) {
  let subTable = null
  let fields:any = null
  let subWhere = null
  const sub_query = cond.query
  if(sub_query) {
    subTable = this.table_map[sub_query.from];
    if (!subTable) throw new Error(`Table '${sub_query.from}' not found`);
    fields = resolve_fields(this.structure, sub_query.select, 'GET', this.role, sub_query.from, this.table_map);
    fields = alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    subWhere = sub_query.where
      ? this.build_where(sub_query.where)
      : undefined;
  }
  let inner_query = this.db.select(fields).from(subTable)
  if(subWhere) {
    inner_query = inner_query.where(subWhere)
  }
  return exists(inner_query);
}

Compiler.prototype.not_exists = function(cond: NotExistsCondition) {
  let subTable = null
  let fields:any = null
  let subWhere = null
  const sub_query = cond.query
  if(sub_query) {
    subTable = this.table_map[sub_query.from];
    if (!subTable) throw new Error(`Table '${sub_query.from}' not found`);
    fields = resolve_fields(this.structure, sub_query.select, 'GET', this.role, sub_query.from, this.table_map);
    fields = alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    subWhere = sub_query.where
      ? this.build_where(sub_query.where)
      : undefined;
  }
  let inner_query = this.db.select(fields).from(subTable)
  if(subWhere) {
    inner_query = inner_query.where(subWhere)
  }
  return notExists(inner_query);
}

Compiler.prototype.in_condition = function(left:any, right: any) {
  if (right != undefined && typeof right === "object" && "select" in right) {
    const subTable = this.table_map[right.from];
    if (!subTable) throw new Error(`Table '${right.from}' not found`);
    let fields = resolve_fields(this.structure, right.select, 'GET', this.role, right.from, this.table_map);
    fields = alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    const subWhere = right.where
      ? this.build_where(right.where)
      : undefined;
    let inner_query = this.db.select(fields).from(subTable)
    if(subWhere) {
      inner_query = inner_query.where(subWhere)
    }
    return inArray(left, inner_query);
  }
  // Normal IN array
  if (Array.isArray(right)) return inArray(left, right);
  throw Error('Wrong values for in condition')
}

Compiler.prototype.not_in_condition = function(left:any, right: any) {
  if (right != undefined && typeof right === "object" && "select" in right) {
      const subTable = this.table_map[right.from];
      if (!subTable) throw new Error(`Table '${right.from}' not found`);
      let fields = resolve_fields(this.structure, right.select, 'GET', this.role, right.from, this.table_map);
      fields = alias_selected_fields(fields);
      if(!fields) throw new Error(`Inner fields not found`);
      const subWhere = right.where
        ? this.build_where(right.where)
        : undefined;
      let inner_query = this.db.select(fields).from(subTable)
      if(subWhere) {
        inner_query = inner_query.where(subWhere)
      }
      return notInArray(left, inner_query);
    }
    // Normal NOT IN array
    if (Array.isArray(right)) return notInArray(left, right);
  throw Error('Wrong values for not in condition')
}

/* -------------------------------------------------------------------------- */
/*                                 SANITIZERS                                 */
/* -------------------------------------------------------------------------- */

Compiler.prototype.check_passed = function(cond: WhereCondition, value: any) {
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

Compiler.prototype.sanitize_undefined = function(value:any) {
  if(value == undefined) return null
  return value
}

/* -------------------------------------------------------------------------- */
/*                               MAIN FUNCTIONS                               */
/* -------------------------------------------------------------------------- */

Compiler.prototype.is_allowed_empty = function(allowed: FieldPermission) {
  if(Array.isArray(allowed) && allowed.length == 0) return true
  else if(!allowed) return true
  else if(allowed == '') return true
  else if(typeof allowed == 'object' && !Array.isArray(allowed) && allowed.field) {
    return this.is_allowed_empty(allowed.field)
  }
  return false
}

Compiler.prototype.build_acl_where = function(allowed: FieldPermission, disallowed: FieldPermission) {
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

Compiler.prototype.compile_policy = function() {
  if(typeof this.where == "boolean" || this.where == undefined) {
    return this.where ?? false
  }
  let where = this.build_where(this.where);

  // Start empty SQL object
  const need_table:boolean = this.query.join ? true : has_field_or_col_attribute(this.where)
  
  const check_query = sql<number>`
    COALESCE(
      MAX(
        CASE WHEN ${where} THEN 1 ELSE 0 END
      ),
      0
    ) AS result
  `;

  const from_table = need_table ? this.table : sql`(select 1) AS t`

  const builded_query = this.db.select({
    result: check_query
  }).from(from_table)

  if(this.query.join) this.build_join(builded_query, this.query.join)

  builded_query.limit(1)
  console.log(builded_query.toSQL().sql, builded_query.toSQL().params)

  this.compiled = {
    ...this.compiled,
    policy: builded_query
  }
}

Compiler.prototype.validate_policy = async function() {
  if(!this.compiled || !this.compiled.policy) {
    throw new Error("Policy validation failed")
  }
  const [rows]: any = await this.compiled.policy.execute()

  console.log(rows)
  const result = rows.result ?? 0;

  if(!Boolean(result)) {
    throw new Error("Not allowed or Empty")
  }
}

Compiler.prototype.define_where = function(allowed: FieldPermission, disallowed: FieldPermission) {
  const aclWhere = this.build_acl_where(allowed, disallowed);

  let query_where = this.where ? validate_where_fields(this.where, this.table_map, this.table_name, this.structure, this.role, this.type) : this.where
  if (query_where && aclWhere) {
      this.where = {
          and: [aclWhere, query_where]
      };
  } else if (query_where) {
      this.where = query_where;
  } else if (aclWhere) {
      this.where = aclWhere
  }

  if (this.where && (typeof allowed != 'string' && !Array.isArray(allowed) || typeof disallowed != 'string' && !Array.isArray(disallowed))) {
    this.compile_policy()
  }

  this.where = this.where ? this.build_where(this.where!) : false
}