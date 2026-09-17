import { alias_selected_fields, resolve_order_by_fields, resolve_returning_fields, toArray } from "../rbac.js";
import { Compiler } from "./index.js";

declare module "./index.js" {
    interface Compiler {
        delete():void;
    }
}

Compiler.prototype.delete = function() {
  const delete_query = this.db.delete(this.table);
  
  if(this.where) {
    delete_query.where(this.where);
  }

  const orderByFields =
    resolve_order_by_fields(this.structure, toArray(this.order_by), this.type, this.role, this.table_name, this.table_map) ??
    toArray(this.role_permissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    delete_query.orderBy(...orderByFields);
  }

  if(this.limit != null) delete_query.limit(this.limit)

  if(this.returning) {
    let fields = resolve_returning_fields(this.structure, this.returning, this.type, this.role, this.table_name, this.table_map)
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