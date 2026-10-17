import { Compiler } from "./index.js";
import { ExistsCondition, FieldPermission, IfCondition, NotExistsCondition, WhereCondition } from "../types.js";
import { and, between, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, like, lt, lte, ne, not, notBetween, notExists, notIlike, notInArray, notLike, or, SQL, sql } from "drizzle-orm";
import { is_op_type, resolveCustomValue } from "./rbac.js";

type BuiltWhere = {
  condition: any;
  needs_table: boolean;
};

declare module "./index.js" {
    interface Compiler {
        build_where(cond: WhereCondition, custom_data?:Record<string, any>): BuiltWhere;
        and(conditions:any[]): any;
        or(conditions:any[]): any;
        if(condition: IfCondition): BuiltWhere;
        exists(condition: ExistsCondition): any;
        not_exists(condition: NotExistsCondition): any;
        in_condition(left:any, right:any): any;
        not_in_condition(left:any, right:any): any;
        check_passed(cond: WhereCondition, value:any): SQL | null;
        sanitize_undefined(value:any): null | any;
        build_acl_where(allowed:FieldPermission, disallowed:FieldPermission): WhereCondition | null;
        compile_policy(): WhereCondition | boolean;
        validate_policy(): Promise<void>
        define_where(allowed:FieldPermission, disallowed:FieldPermission): void;
        is_allowed_empty(allowed: FieldPermission): boolean;
    }
}

/* -------------------------------------------------------------------------- */
/*                                WHERE BUILDER                               */
/* -------------------------------------------------------------------------- */

Compiler.prototype.build_where = function(cond: WhereCondition, custom_data?:Record<string, any>): BuiltWhere {
  let needs_table = false;
  const build_child = (child: WhereCondition, child_custom_data?: Record<string, any>) => {
    const built = this.build_where(child, child_custom_data);
    needs_table ||= built.needs_table;
    return built.condition;
  };

  if(cond == undefined) return { condition: undefined, needs_table };
  if(typeof cond == 'boolean') return { condition: cond, needs_table };

  if (cond && typeof cond === "object") {
    const validateColRef = (value: any) => {
      if (typeof value !== "string") return;

      const match = value.match(/^\$col\.(.+)$/);
      if (
        match &&
        !this.is_allowed_field(match[1])
      ) {
        throw Error(`Field ${match[1]} not allowed in where condition`);
      }
      if (match) needs_table = true;
    };

    if ("field" in cond && cond.field) {
      if (
        !this.is_allowed_field(cond.field)
      ) {
        throw Error(`Field ${cond.field} not allowed in where condition`);
      }
      needs_table = true;
    }

    if ("value" in cond) validateColRef(cond.value);
    if ("left_value" in cond) validateColRef(cond.left_value);
    if ("start" in cond) validateColRef(cond.start);
    if ("end" in cond) validateColRef(cond.end);
  }
  
  if ("and" in cond && cond.and) {
    const parts = cond.and.map(c => build_child(c));

    return { condition: this.and(parts), needs_table };
  }
  else if ("or" in cond && cond.or) {
    const parts = cond.or.map(c => build_child(c));

    return { condition: this.or(parts), needs_table };
  }
  else if('if' in cond && cond.if && "when" in cond.if && cond.if.when != undefined) {
    const built = this.if(cond);
    return { condition: built.condition, needs_table: needs_table || built.needs_table };
  }else if('not' in cond && cond.not != undefined) {
    return { condition: not(build_child(cond.not)), needs_table };
  }

  if (cond && ('op' in cond || 'operator' in cond) && is_op_type(cond, "EXISTS") && 'query' in cond) {
    return { condition: this.exists(cond), needs_table };
  }

  if (cond && ('op' in cond || 'operator' in cond) && is_op_type(cond, "NOT EXISTS") && 'query' in cond) {
    return { condition: this.not_exists(cond), needs_table };
  }

  // Determine left side
  let left: any;
  let right: any;

  let start: any
  let end: any

  if (
    !custom_data &&
    !("if" in cond) &&
    this.requests_data(cond, "before") &&
    this.before_values &&
    Array.isArray(this.before_values)
  ) {
    const parts = this.before_values.map(custom_data =>
      build_child(cond, custom_data)
    );

    return { condition: this.and(parts), needs_table };

  } else if (
    !custom_data &&
    !("if" in cond) &&
    this.requests_data(cond, "after") &&
    this.after_values &&
    Array.isArray(this.after_values)
  ) {
    const parts = this.after_values.map(custom_data =>
      build_child(cond, custom_data)
    );

    return { condition: this.and(parts), needs_table };

  } else if (
    !custom_data &&
    !("if" in cond) &&
    this.requests_data(cond, "result") &&
    this.result_values &&
    Array.isArray(this.result_values)
  ) {
    const parts = this.result_values.map(custom_data =>
      build_child(cond, custom_data)
    );

    return { condition: this.and(parts), needs_table };

  } else if (
    !custom_data &&
    !("if" in cond) &&
    this.requests_data(cond, "data") &&
    this.data &&
    Array.isArray(this.data)
  ) {
    const parts = this.data.map(custom_data =>
      build_child(cond, custom_data)
    );

    return { condition: this.and(parts), needs_table };
  }

  if ("left_value" in cond) {
    const left_value = resolveCustomValue(cond.left_value, this.user, this.query, this.table_map, this.table_name, custom_data)
    const passed = this.check_passed(cond, left_value)
    if(passed != null) return { condition: passed, needs_table }
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
    if(passed != null) return { condition: passed, needs_table }
    left = sql`${this.sanitize_undefined(value)}`;
  } else {
    console.log(cond)
    throw new Error("Condition must have 'field' or 'left_value' or 'value");
  }

  if ("value" in cond) {
    const right_value = resolveCustomValue(cond.value, this.user, this.query, this.table_map, this.table_name, custom_data)
    const passed = this.check_passed(cond, right_value)
    if(passed != null) return { condition: passed, needs_table }
    right = sql`${this.sanitize_undefined(right_value)}`;
  }
  
  if("start" in cond && "end" in cond && is_op_type(cond, "BETWEEN")) {
    const start_value = resolveCustomValue(cond.start, this.user, this.query, this.table_map, this.table_name, custom_data)
    const start_passed = this.check_passed(cond, start_value)
    if(start_passed != null) return { condition: start_passed, needs_table }
    start = sql`${this.sanitize_undefined(start_value)}`;
    const end_value = resolveCustomValue(cond.end, this.user, this.query, this.table_map, this.table_name, custom_data)
    const end_passed = this.check_passed(cond, end_value)
    if(end_passed != null) return { condition: end_passed, needs_table }
    end = sql`${this.sanitize_undefined(end_value)}`;
  } else if(("start" in cond || "end" in cond)) {
    throw new Error("'start' or 'end' fields must have a compatible operator");
  } else if(is_op_type(cond, "BETWEEN") && !("start" in cond && "end" in cond)) {
    throw new Error("Between operator must have 'start' and 'end' fields");
  }

  // Subquery IN
  if(is_op_type(cond, "IN") && (left != null && left !=undefined)) {
    return { condition: this.in_condition(left, right), needs_table }
  }else if(is_op_type(cond, "IN")) {
    return { condition: sql`false`, needs_table }
  }

  if(is_op_type(cond, "NOT IN") && (left != null && left !=undefined)) {
    return { condition: this.not_in_condition(left, right), needs_table }
  }else if(is_op_type(cond, "NOT IN")) {
    return { condition: sql`false`, needs_table }
  }

  const operator = cond.operator ?? cond.op

  // Literal operators
  if(operator) {
    switch (operator.toUpperCase()) {
      case "=": {
        if(right == null) return { condition: isNull(left), needs_table }
        else return { condition: eq(left, right), needs_table }
      };
      case "!=": {
        if(right == null) return { condition: isNull(left), needs_table }
        else return { condition: ne(left, right), needs_table }
      };
      case "<": return { condition: lt(left, right), needs_table };
      case "<=": return { condition: lte(left, right), needs_table };
      case ">": return { condition: gt(left, right), needs_table };
      case ">=": return { condition: gte(left, right), needs_table };
      case "LIKE": return { condition: like(left, right), needs_table };
      case "NOT LIKE": return { condition: notLike(left, right), needs_table };
      case "ILIKE": return { condition: ilike(left, right), needs_table };
      case "NOT ILIKE": return { condition: notIlike(left, right), needs_table };
      case "IS": {
        if(right == null) return { condition: isNull(left), needs_table }
        else throw new Error(`Unsupported operator: ${operator}`);
      };
      case "IS NOT": {
        if(right == null) return { condition: isNotNull(left), needs_table }
        else throw new Error(`Unsupported operator: ${operator}`);
      };
      case "IS NULL": return { condition: isNull(left), needs_table };
      case "IS NOT NULL": return { condition: isNotNull(left), needs_table };
      case "BETWEEN": {
        return { condition: between(left, start, end), needs_table }
      }
      case "NOT BETWEEN": {
        return { condition: notBetween(left, start, end), needs_table }
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

Compiler.prototype.if = function(cond: IfCondition): BuiltWhere {
  const build_branch = (branch: IfCondition["if"]["do"] | IfCondition["if"]["else"]) => {
    if (typeof branch === "function") {
      throw new Error("Function not allowed in where condition");
    }

    if (branch && typeof branch === "object" && "type" in branch) {
      throw new Error("Structured Query not allowed in where condition");
    }

    const built = branch === undefined
      ? { condition: false, needs_table: false }
      : this.build_where(branch as WhereCondition);
    return {
      condition: typeof built.condition === "boolean" ? sql`${built.condition}` : built.condition,
      needs_table: built.needs_table,
    };
  };

  const when = this.build_where(cond.if.when);
  const do_condition = build_branch(cond.if.do);
  const else_condition = build_branch(cond.if.else);

  return {
    condition: sql<boolean>`CASE WHEN ${when.condition} THEN ${do_condition.condition} ELSE ${else_condition.condition} END`,
    needs_table: when.needs_table || do_condition.needs_table || else_condition.needs_table,
  };
}

Compiler.prototype.exists = function(cond: ExistsCondition) {
  let subTable = null
  let fields:any = null
  let subWhere = null
  const sub_query = cond.query
  if(sub_query) {
    subTable = this.table_map[sub_query.from];
    if (!subTable) throw new Error(`Table '${sub_query.from}' not found`);
    fields = this.resolve_fields(sub_query.select, 'GET', sub_query.from);
    fields = this.alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    subWhere = sub_query.where
      ? this.build_where(sub_query.where).condition
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
    fields = this.resolve_fields(sub_query.select, 'GET', sub_query.from);
    fields = this.alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    subWhere = sub_query.where
      ? this.build_where(sub_query.where).condition
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
    let fields = this.resolve_fields(right.select, 'GET', right.from);
    fields = this.alias_selected_fields(fields);
    if(!fields) throw new Error(`Inner fields not found`);
    const subWhere = right.where
      ? this.build_where(right.where).condition
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
      let fields = this.resolve_fields(right.select, 'GET', right.from);
      fields = this.alias_selected_fields(fields);
      if(!fields) throw new Error(`Inner fields not found`);
      const subWhere = right.where
        ? this.build_where(right.where).condition
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
  const { condition: where, needs_table } = this.build_where(this.where);

  // Start empty SQL object
  const need_table = this.query.join ? true : needs_table
  
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

  return where
}

Compiler.prototype.validate_policy = async function() {
  if(!this.compiled || !this.compiled.policy) {
    return
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

  if (this.where && aclWhere) {
    this.where = {
        and: [aclWhere, this.where]
    };
  } else if (aclWhere) {
    this.where = aclWhere
  }

  if (this.where) {
    this.where = this.compile_policy()
  }else this.where = false
}