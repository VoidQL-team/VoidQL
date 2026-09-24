import { alias_selected_fields, resolve_order_by_fields, resolve_returning_fields, toArray } from "../rbac.js";
import { Compiler } from "./index.js";

declare module "./index.js" {
    interface Compiler {
        delete():void;
    }
}

Compiler.prototype.delete = function() {
  const q = this.db.delete(this.table);
  
  if(this.where) {
    q.where(this.where);
  }

  const orderByFields =
    resolve_order_by_fields(this.structure, toArray(this.order_by), this.type, this.role, this.table_name, this.table_map) ??
    toArray(this.role_permissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    q.orderBy(...orderByFields);
  }

  if(this.limit != null) q.limit(this.limit)

  if(this.returning) {
    let fields = resolve_returning_fields(this.structure, this.returning, this.type, this.role, this.table_name, this.table_map)
    fields = alias_selected_fields(fields)
    if (Object.keys(fields).length === 0) {
      throw new Error("No valid returning fields allowed");
    }
    if (typeof q.returning === 'function') {
      q.returning(fields);
    }else if (typeof q.output === 'function') {
      q.output(fields);
    }
  }
  
  this.compiled = {
    ...this.compiled,
    query: q
  }
}