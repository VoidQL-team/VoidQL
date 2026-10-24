import { Compiler } from "./index.js";

/* -------------------------------------------------------------------------- */
/*                            DELETE QUERY COMPILER                           */
/* -------------------------------------------------------------------------- */

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

  const order_by_fields =
    this.resolve_order_by_fields() ??
    this.to_array(this.role_permissions?.order_by) ??
    [];

  if (order_by_fields.length > 0) {
    q.orderBy(...order_by_fields);
  }

  if(this.limit != null) q.limit(this.limit)

  if(this.returning) {
    let fields = this.resolve_returning_fields()
    fields = this.alias_selected_fields(fields)
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