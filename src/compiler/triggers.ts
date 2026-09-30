import { Compiler } from "./index.js";
import { Endpoint, SetCondition, WhereCondition } from "../types.js";
import { resolve_returning_fields, resolveCustomValue } from "../rbac.js";
import { getTableName, sql } from "drizzle-orm";

declare module "./index.js" {
    interface Compiler {
        define_triggers(endpoint: Endpoint):void;
        execute_triggers(type: "before_triggers" | "after_triggers"): Promise<void>;
        handle_after(result:any): Promise<{after: any, result: any}>;
        build_triggers(type: "before_triggers" | "after_triggers"): Promise<void>;
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

Compiler.prototype.build_triggers = function (type: "before_triggers" | "after_triggers", before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]) {
  const triggers = this[type]
  if(!triggers) return
  for(let trigger of triggers) {
    if(trigger.query != undefined && "if" in trigger.query) {
      const condition = trigger.query.if
      const when_condition = await if_condition(db, condition.when, tableMap, user, role, structure, query, tableStruct.table)
      if(when_condition && condition.do) {
        if(typeof condition.do == "function" && "type" in condition.do) {
          const params = {
            before: before_values,
            after: after_values,
            result: result_values
          }
          await condition.do(params);
        }else if(typeof condition.do == "object" && "type" in condition.do) {
          try{
            await (await build_query(db, condition.do, user, role, structure, {
              disable_triggers: true,
              ...options
            }, before_values, after_values, result_values)).execute()
          }catch(err) {
            throw err;
          }
        }
      }else if(!when_condition && condition.else) {
        if(typeof condition.else == "function" && "type" in condition.else) {
          const params = {
            before: before_values,
            after: after_values,
            result: result_values
          }
          await condition.else(params);
        }else if(typeof condition.else == "object" && "type" in condition.else) {
          try{
            await (await build_query(db, condition.else, user, role, structure, {
              disable_triggers: true,
              ...options
            }, before_values, after_values, result_values)).execute()
          }catch(err) {
            throw err
          }
        }
      }
    }
    if (trigger.query != undefined && "set" in trigger.query) {
      function set_value(
        set: SetCondition,
        where: WhereCondition,
        table_name: string,
        user: any,
        query: any,
        tableMap: any,
        i?: number,
        custom_value?: any,
      ) {
        if(!set) return
        const value = sql`${resolveCustomValue(
          set.value,
          user,
          query,
          tableMap,
          table_name,
          custom_value
        )}`

        let fallback_value;

        if ("else_value" in set) {
          fallback_value = sql`${resolveCustomValue(
            set.else_value,
            user,
            query,
            tableMap,
            table_name,
            custom_value
          )}`
        } else {
          const existing =
            typeof i === "number"
              ? selected_data_fields?.[i]?.[set.field]
              : selected_data_fields?.[set.field];

          fallback_value = existing ?? sql`COALESCE(${value}, '')`;
        }

        console.log("SETTING:", set.field, "ROW:", i ?? "single");

        const target =
          typeof i === "number"
            ? selected_data_fields[i]
            : selected_data_fields;

        target[set.field] = sql`
          CASE 
            WHEN ${where} THEN ${value}
            ELSE ${fallback_value}
          END
        `;
      }

      const set = trigger.query.set

      const where = this.build_where(set.when)

      if (this.data && Array.isArray(this.data)) {
        for (let i = 0; i < this.data.length; i++) {

          set_value(set, where, this.table_name, i, this.data[i]);
        }
      }else set_value(set, where, this.table_name);
    }
    if(trigger.query != undefined && "type" in trigger.query) {
      try{
        return new Compiler({
            db: this.db,
            user: this.user,
            role: this.role,
            structure: this.structure,
            options: {
              disable_triggers: true,
              ...this.options
            },
            query: trigger.query,
            before_values,
            after_values,
            result_values,
        });
      }catch(err) {
        throw err;
      }
    }
  }
  return selected_data_fields
}