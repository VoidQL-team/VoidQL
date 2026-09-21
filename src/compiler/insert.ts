import { getColumns, inArray } from "drizzle-orm";
import { resolve_returning_fields } from "../rbac.js";
import { Compiler } from "./index.js";

declare module "./index.js" {
    interface Compiler {
        insert():void;
    }
}

Compiler.prototype.insert = function() {
  if (!this.data) throw new Error("POST requires data");

  const q = this.db
    .insert(this.table)
    .values(this.select);
  
  let after_function:any = null;
    
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
    
  this.compiled_query = q

  // let after: any = null;

  // if (this.returning || has_after_triggers) {
  //   if (after_function) {
  //     after = await after_function(result);
  //   } else {
  //     after = result
  //   }
  //   if(this.returning) {
  //     const allowedFields = Object.keys(
  //       resolve_returning_fields(
  //         this.structure,
  //         this.returning,
  //         this.type,
  //         this.role,
  //         this.table_name,
  //         this.table_map
  //       )
  //     );

  //     result =
  //       allowedFields.length === 0
  //         ? []
  //         : after.map((row: Record<string, any>) => {
  //             const filtered: Record<string, any> = {};

  //             for (const field of allowedFields) {
  //               if (row != undefined && field in row) {
  //                 filtered[field] = row[field];
  //               }
  //             }

  //             return filtered;
  //           });
  //   }else result = []
  // }

  // return { result, after };
}