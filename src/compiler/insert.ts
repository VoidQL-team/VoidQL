import { getColumns, inArray } from "drizzle-orm";
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