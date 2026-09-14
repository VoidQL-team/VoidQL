import { and, eq } from "drizzle-orm";
import { Compiler } from "./index.js";
import { resolve_group_by_fields, resolve_order_by_fields, toArray } from "../rbac.js";

declare module "./index.js" {
    interface Compiler {
        get():void;
        build_join(q: any, joins: any[]):void;
    }
}

Compiler.prototype.get = function () {
    if(!this.select) throw new Error("No allowed fields");
    const q = this.db.select(this.select).from(this.table);

    if (this.query.join) this.build_join(q, this.query.join)

    if (this.where) q.where(this.where);

    const groupByFields =
        resolve_group_by_fields(this.structure, toArray(this.query.group_by), this.type, this.role, this.table_name, this.table_map) ??
        toArray(this.role_permissions?.group_by) ??
        [];

    if (groupByFields.length > 0) {
        q.groupBy(...groupByFields);
    }

    const orderByFields =
        resolve_order_by_fields(this.structure, toArray(this.query.order_by), this.type, this.role, this.table_name, this.table_map) ??
        toArray(this.role_permissions?.order_by) ??
        [];

    if (orderByFields.length > 0) {
        q.orderBy(...orderByFields);
    }

    if(this.limit != null) q.limit(this.limit)

    this.compiled_query = q
}

Compiler.prototype.build_join = function(q: any, joins: any[]) {
  for (const j of joins) {
    const joinStruct = this.table_map[j.table];
    if (!joinStruct) throw new Error(`Table '${j.table}' not found in tableMap`);

    let joinCondition: any;

    // Support object with AND/OR inside 'on'
    if (j.on && j.on.type && (j.on.type.toUpperCase() === "AND" || j.on.type.toUpperCase() === "OR")) {
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