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

  const update_query = this.db.update(this.table).set(this.data)
  
  if(this.where) {
    update_query.where(this.where)
  }

  const orderByFields =
    resolve_order_by_fields(this.structure, toArray(this.query.order_by), this.type, this.role, this.table_name, this.table_map) ??
    toArray(this.role_permissions?.order_by) ??
    [];

  if (orderByFields.length > 0) {
    update_query.orderBy(...orderByFields);
  }

  if(this.limit != null) update_query.limit(this.limit)

  let after_function:any = null;
    
  if(this.query.returning || has_after_triggers) {
    let fields = getColumns(this.table)
    if (typeof update_query.returning === 'function') {
      update_query.returning(fields);
    }else if (typeof update_query.$returningId === 'function') {
      update_query.$returningId(fields);
      after_function = async (result:any) => {
        if(!result) return
        const fieldName = Object.keys(result[0])[0];
        const values = result.map((obj:any) => Object.values(obj)[0]);
        const after = await this.db.select().from(this.table).where(inArray(this.table[fieldName], values)).execute()
        return after
      }
    }else if (typeof update_query.output === 'function') {
      update_query.output(fields);
    }
  }

  console.log(update_query.toSQL().sql, update_query.toSQL().params)
    
  let result = await update_query.execute();

  let after: any = null;

  if (query.returning || has_after_triggers) {
    if (after_function) {
      after = await after_function(result);
    } else {
      after = result
    }
    if(query.returning) {
      const allowedFields = Object.keys(
        resolve_returning_fields(
          structure,
          query.returning,
          query.type,
          role,
          tableName,
          tableMap
        )
      );

      result =
        allowedFields.length === 0
          ? []
          : after.map((row: Record<string, any>) => {
              const filtered: Record<string, any> = {};

              for (const field of allowedFields) {
                if (row != undefined && field in row) {
                  filtered[field] = row[field];
                }
              }

              return filtered;
            });
    }else result = []
  }

  return { result, after };
}