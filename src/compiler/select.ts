import { and, eq } from "drizzle-orm";
import { Compiler } from "./index.js";
import { Join, SelectOptions, WhereCondition } from "../types.js";

/* -------------------------------------------------------------------------- */
/*                            SELECT QUERY COMPILER                           */
/* -------------------------------------------------------------------------- */

declare module "./index.js" {
  interface Compiler {
    get(settings?: SelectOptions):void;
    build_join(q: any, joins: Join[]):void;
  }
}

Compiler.prototype.get = function (settings?: SelectOptions) {
    if(!this.select) throw new Error("No allowed fields");
    const select_fields = settings ? settings.select : this.select
    const q = this.db.select(select_fields).from(this.table);

    if (this.query.join) this.build_join(q, this.query.join)

    if (this.where) q.where(this.where);

    const group_by_fields =
        this.resolve_group_by_fields() ??
        this.to_array(this.role_permissions?.group_by) ??
        [];

    if (group_by_fields.length > 0) {
        q.groupBy(...group_by_fields);
    }

    const order_by_fields =
        this.resolve_order_by_fields() ??
        this.to_array(this.role_permissions?.order_by) ??
        [];

    if (order_by_fields.length > 0) {
        q.orderBy(...order_by_fields);
    }

    if(this.limit != null) q.limit(this.limit)

    const key = settings?.key ? settings.key : "query"
    this.compiled = {
      ...this.compiled,
      [key]: q
    }
}

/* -------------------------------------------------------------------------- */
/*                                JOIN COMPILER                               */
/* -------------------------------------------------------------------------- */

function is_where_condition(
  on: Join["on"]
): on is WhereCondition {
  if (typeof on === "boolean") {
    return true;
  }

  if (!on || typeof on !== "object" || Array.isArray(on)) {
    return false;
  }

  return (
    "operator" in on ||
    "op" in on ||
    "and" in on ||
    "or" in on ||
    "not" in on ||
    "if" in on
  );
}

Compiler.prototype.build_join = function(q: any, joins: Join[]) {
  for (const j of joins) {
    const join_struct = this.table_map[j.table];
    if (!join_struct) throw new Error(`Table '${j.table}' not found in table_map`);

    let join_condition: any;

    // Support object with AND/OR inside 'on'
    if (is_where_condition(j.on)) {
      // Complex condition
      join_condition = this.build_where(j.on).condition
    } else {
      // Simple key-value mapping
      const conditions: any[] = [];
      for (const left_key in j.on) {
        const right_key = j.on[left_key];
        const [l_tbl, l_col] = left_key.split(".");
        const [r_tbl, r_col] = right_key.split(".");

        const l = this.table_map[l_tbl]?.[l_col];
        const r = this.table_map[r_tbl]?.[r_col];

        if (!l || !r) throw new Error(`Invalid join keys: ${left_key} -> ${right_key}`);
        conditions.push(eq(l, r));
      }

      // If multiple conditions, combine with AND
      join_condition = conditions.length > 1 ? and(...conditions) : conditions[0];
    }

    const join_table = this.table_map[j.table];
    if (!join_table) throw new Error(`Join table '${j.table}' not found in table_map`);

    // Apply the join type
    if (j.type.toUpperCase() === "INNER") q.innerJoin(join_table, join_condition);
    else if (j.type.toUpperCase() === "LEFT") q.leftJoin(join_table, join_condition);
    else throw new Error(`Unsupported join type: ${j.type}`);
  }
}