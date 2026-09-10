import { Compiler } from "./index.js";
import { ExistsCondition, NotExistsCondition, WhereCondition } from "../types.js";
import { and, between, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, like, lt, lte, ne, not, notBetween, notExists, notIlike, notInArray, notLike, or, sql } from "drizzle-orm";
import { alias_selected_fields, is_op_type, requests_data, resolve_fields } from "../rbac.js";

declare module "./index.js" {
    interface Compiler {
        build_where(cond: WhereCondition, custom_data?:Record<string, any>): any;
        and(conditions:any[]): any;
        or(conditions:any[]): any;
        exists(condition: ExistsCondition): any;
        not_exists(condition: NotExistsCondition): any;
        in_condition(left:any, right:any):any;
        not_in_condition(left:any, right:any):any;
    }
}

Compiler.prototype.build_where = function (cond: WhereCondition, custom_data?:Record<string, any>): any {
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
        return await if_conditions(db, cond, tableMap, user, role, structure, query, default_table, default_table_name, before_values, after_values, result_values)
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
        this.query.data &&
        Array.isArray(this.query.data)
    ) {
        const parts = this.query.data.map(custom_data =>
            this.build_where(cond, custom_data)
        );

        return this.and(parts);
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
};

Compiler.prototype.and = function (conditions:any[]) { 
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

Compiler.prototype.or = function (conditions: any[]) {
  const is_one_boolean = conditions.some(cond => typeof cond == "boolean")
  if(is_one_boolean) {
    const has_true = conditions.some(cond => typeof cond === "boolean" && cond === true)
    if(has_true) return sql`true`
  }
  return or(...conditions);
}

Compiler.prototype.exists = function (cond: ExistsCondition) {
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

Compiler.prototype.not_exists = function (cond: NotExistsCondition) {
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