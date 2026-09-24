import { and, eq } from "drizzle-orm";
import { Compiler } from "./index.js";
import { resolve_group_by_fields, resolve_order_by_fields, toArray } from "../rbac.js";
import { Join, SelectOptions, WhereCondition } from "../types.js";

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

    const groupByFields =
        resolve_group_by_fields(this.structure, toArray(this.group_by), this.type, this.role, this.table_name, this.table_map) ??
        toArray(this.role_permissions?.group_by) ??
        [];

    if (groupByFields.length > 0) {
        q.groupBy(...groupByFields);
    }

    const orderByFields =
        resolve_order_by_fields(this.structure, toArray(this.order_by), this.type, this.role, this.table_name, this.table_map) ??
        toArray(this.role_permissions?.order_by) ??
        [];

    if (orderByFields.length > 0) {
        q.orderBy(...orderByFields);
    }

    if(this.limit != null) q.limit(this.limit)

    const key = settings?.key ? settings.key : "query"
    this.compiled = {
      ...this.compiled,
      [key]: q
    }
}

function isWhereCondition(
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
    const joinStruct = this.table_map[j.table];
    if (!joinStruct) throw new Error(`Table '${j.table}' not found in tableMap`);

    let joinCondition: any;

    // Support object with AND/OR inside 'on'
    if (isWhereCondition(j.on)) {
      // Complex condition
      joinCondition = this.build_where(j.on)
    } else {
      // Simple key-value mapping
      const conditions: any[] = [];
      for (const leftKey in j.on) {
        const rightKey = j.on[leftKey];
        const [lTbl, lCol] = leftKey.split(".");
        const [rTbl, rCol] = rightKey.split(".");

        const l = this.table_map[lTbl]?.[lCol];
        const r = this.table_map[rTbl]?.[rCol];

        if (!l || !r) throw new Error(`Invalid join keys: ${leftKey} -> ${rightKey}`);
        conditions.push(eq(l, r));
      }

      // If multiple conditions, combine with AND
      joinCondition = conditions.length > 1 ? and(...conditions) : conditions[0];
    }

    const joinTable = this.table_map[j.table];
    if (!joinTable) throw new Error(`Join table '${j.table}' not found in tableMap`);

    // Apply the join type
    if (j.type.toUpperCase() === "INNER") q.innerJoin(joinTable, joinCondition);
    else if (j.type.toUpperCase() === "LEFT") q.leftJoin(joinTable, joinCondition);
    else throw new Error(`Unsupported join type: ${j.type}`);
  }
}