import { getColumns, inArray } from "drizzle-orm";
import { resolve_order_by_fields, toArray } from "../rbac.js";
import { Compiler } from "./index.js";

declare module "./index.js" {
    interface Compiler {
        update():void;
    }
}

Compiler.prototype.update = function() {
  if (!this.data) throw new Error("PUT requires data");

  const q = this.db.update(this.table).set(this.data)
  
  if(this.where) {
    q.where(this.where)
  }

  const orderByFields =
    resolve_order_by_fields(this.structure, toArray(this.order_by), this.type, this.role, this.table_name, this.table_map) ??
    toArray(this.role_permissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    q.orderBy(...orderByFields);
  }

  if(this.limit != null) q.limit(this.limit)

  let after_function = undefined;
    
  if(this.returning || (this.after_triggers && this.after_triggers.length != 0)) {
    let fields = getColumns(this.table)
    if (typeof q.returning === 'function') {
      q.returning(fields);
    }else if (typeof q.$returningId === 'function') {
      q.$returningId(fields);
      after_function = async (result:any) => {
        if(!result) return
        const fieldName = Object.keys(result[0])[0];
        const table:any = this.table
        const values = result.map((obj:any) => Object.values(obj)[0]);
        const after = await this.db.select().from(table).where(inArray(table[fieldName], values)).execute()
        return after
      }
    }else if (typeof q.output === 'function') {
      q.output(fields);
    }
  }
    
  this.compiled = {
    ...this.compiled,
    query: q,
    after_function
  }
}