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
    this.resolve_order_by_fields() ??
    this.to_array(this.role_permissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    q.orderBy(...orderByFields);
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