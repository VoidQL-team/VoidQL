import { Compiler } from "./index.js";
import { Endpoint } from "../types.js";
import { resolve_returning_fields } from "../rbac.js";

declare module "./index.js" {
    interface Compiler {
        define_triggers(endpoint: Endpoint):void;
        execute_triggers(type: "before_triggers" | "after_triggers"): Promise<void>;
        handle_after(result:any): Promise<{after: any, result: any}>
    }
}

Compiler.prototype.define_triggers = function(endpoint: Endpoint) {
    if(!this.options.disable_triggers) {
        const { before_triggers, after_triggers } = endpoint.triggers ? endpoint.triggers.reduce(
            (acc, trigger) => {
                if (trigger.type.toUpperCase() === 'AFTER') {
                    if (acc.after_triggers) acc.after_triggers.push(trigger);
                } else if (trigger.type.toUpperCase() === 'BEFORE') {
                    if (acc.before_triggers) acc.before_triggers.push(trigger);
                }
                return acc;
            },
            { before_triggers: [] as typeof endpoint.triggers, after_triggers: [] as typeof endpoint.triggers }
        ) : { before_triggers: null, after_triggers: null }
        
        if(before_triggers) this.before_triggers = before_triggers
        if(after_triggers) this.after_triggers = after_triggers
    }
}

Compiler.prototype.execute_triggers = async function(type: "before_triggers" | "after_triggers") {
    const triggers = this.compiled?.[type];

    if (!triggers) return;

    for (const trigger of triggers) {
        await trigger.execute();
    }
}

Compiler.prototype.handle_after = async function (result:any): Promise<{after: any, result: any}> {
    let after: any = null;

  if (this.returning || (this.after_triggers && this.after_triggers.length != 0)) {
    if (this.compiled && this.compiled.after_function && typeof this.compiled.after_function == "function") {
      after = await this.compiled.after_function(result);
    } else {
      after = result
    }
    if(this.returning) {
      const allowedFields = Object.keys(
        resolve_returning_fields(
          this.structure,
          this.returning,
          this.type,
          this.role,
          this.table_name,
          this.table_map
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

  return { after, result }
}