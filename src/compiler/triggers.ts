import { getTableName, sql } from "drizzle-orm";
import { Compiler } from "./index.js";
import {
  type BuildWhereOptions,
  type Database,
  type Endpoint,
  type SetCondition,
  type Structure,
  type StructuredQuery,
  type SubqueryCondition,
  type TableStructure,
  type Transaction,
  type TriggerStructure,
  type WhereCondition,
} from "../types.js";
import { if_condition } from "../old/drizzle.ts.old";

type TriggerValues = {
  before?: any | any[];
  after?: any | any[];
  result?: any | any[];
};

type TriggerContext = {
  db: Database | Transaction;
  user: any;
  role: string;
  structure: Structure;
  options: BuildWhereOptions;
  query: StructuredQuery;
  tableMap: Record<string, any>;
  tableName: string;
  tableStruct: TableStructure;
  data?: Record<string, any> | Record<string, any>[];
  buildWhere: (
    condition: WhereCondition | SubqueryCondition,
    customData?: Record<string, any>,
  ) => any;
  resolveCustomValue: (
    value: any,
    customData?: Record<string, any>,
  ) => any;
  buildQuery: (
    query: StructuredQuery,
    values: TriggerValues,
  ) => Compiler;
};

export class Trigger {
  private action: ()=> Promise<any[] | undefined | void>;
  constructor(
    private readonly definition: TriggerStructure,
    private readonly context: TriggerContext,
    type: "before_triggers" | "after_triggers", 
    values: TriggerValues
  ) {
    const query = this.definition.query;

    if ("if" in query) {
      const condition = query.if;
      const shouldRun = if_condition(
        this.context.db,
        condition.when,
        this.context.tableMap,
        this.context.user,
        this.context.role,
        this.context.structure,
        this.context.query,
        this.context.tableStruct.table,
        values.before,
        values.after,
        values.result,
      );
      const action = shouldRun ? condition.do : condition.else;
      this.action = async ()=> await this.executeAction(action, values)
    }

    if ("set" in query) {
      if (type === "after_triggers") {
        throw new Error("Set triggers are only available before the query");
      }
      this.action = async ()=> this.applySet(query.set)
    }

    if ("type" in query) {
      this.action = async ()=> await this.context.buildQuery(query, values).execute()
    }

    this.action = async ()=>{}
  }

  async execute(): Promise<any[] | undefined | void> {
    return await this.action()
  }

  private async executeAction(
    action: unknown,
    values: TriggerValues,
  ): Promise<void> {
    if (typeof action === "function") {
      await action(values);
      return;
    }

    if (
      action !== null &&
      typeof action === "object" &&
      "type" in action
    ) {
      await this.context
        .buildQuery(action as StructuredQuery, values)
        .execute();
    }
  }

  private applySet(set: SetCondition): void {
    const data = this.context.data;
    if (!data) {
      throw new Error("Cannot apply set trigger without target data");
    }

    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const where = this.context.buildWhere(set.when, row);
      const value = sql`${this.context.resolveCustomValue(set.value, row)}`;
      const fallback =
        "else_value" in set
          ? sql`${this.context.resolveCustomValue(set.else_value, row)}`
          : row[set.field] ?? sql`COALESCE(${value}, '')`;

      row[set.field] = sql`
        CASE
          WHEN ${where} THEN ${value}
          ELSE ${fallback}
        END
      `;
    }
  }

  private async if_condition(db:Database | Transaction, where_condtion:WhereCondition, table_map:any, user:any, role: string, structure: Structure, query:StructuredQuery, default_table:any, before_values?:any | any[], after_values?:any | any[], result_values?:any | any[]):Promise<boolean> {
    if(typeof where_condtion == "boolean") {
      return where_condtion
    }
    let where = await buildWhere(db, where_condtion, table_map, user, role, structure, query, default_table, getTableName(default_table), undefined, before_values, after_values, result_values);

    // Start empty SQL object
    const need_table:boolean = query.join ? true : has_field_or_col_attribute(where_condtion)
    
    const check_query = sql<number>`
      COALESCE(
        MAX(
          CASE WHEN ${where} THEN 1 ELSE 0 END
        ),
        0
      ) AS result
    `;

    const from_table = need_table ? default_table : sql`(select 1) AS t`

    const builded_query = db.select({
      result: check_query
    }).from(from_table)

    if(query.join) await buildJoin(db, builded_query, query.join, table_map, user, role, structure, query, from_table, before_values, after_values, result_values)

    builded_query.limit(1)
    console.log(builded_query.toSQL().sql, builded_query.toSQL().params)
    const [rows]: any = await builded_query.execute()

    console.log(rows)
    const result = rows.result ?? 0;

    // Return as boolean
    return Boolean(result);
  }
}

declare module "./index.js" {
  interface Compiler {
    define_triggers(endpoint: Endpoint): void;
    execute_triggers(
      type: "before_triggers" | "after_triggers",
      values?: TriggerValues,
    ): Promise<void>;
    handle_after(result: any): Promise<{ after: any; result: any }>;
    build_triggers(
      type: "before_triggers" | "after_triggers",
      values?: TriggerValues,
    ): Promise<void>;
  }
}

Compiler.prototype.define_triggers = function(endpoint: Endpoint) {
  if (this.options.disable_triggers || !endpoint.triggers) return;

  this.before_triggers = endpoint.triggers.filter(
    (trigger) => trigger.type.toUpperCase() === "BEFORE",
  );
  this.after_triggers = endpoint.triggers.filter(
    (trigger) => trigger.type.toUpperCase() === "AFTER",
  );
};

Compiler.prototype.execute_triggers = async function(
  type: "before_triggers" | "after_triggers",
  values: TriggerValues = {},
) {
  if(this.compiled && this.compiled[type]) {
    const triggers = this.compiled[type]
    for(const trigger of triggers) {
      await trigger.execute()
    }
  }
};

Compiler.prototype.handle_after = async function(result: any): Promise<{ after: any; result: any }> {
  let after: any = null;

  if (this.returning || (this.after_triggers && this.after_triggers.length !== 0)) {
    after =
      this.compiled?.after_function && typeof this.compiled.after_function === "function"
        ? await this.compiled.after_function(result)
        : result;

    if (this.returning) {
      const allowedFields = Object.keys(
        this.resolve_returning_fields(),
      );

      result =
        allowedFields.length === 0
          ? []
          : (after ?? []).map((row: Record<string, any>) => {
              const filtered: Record<string, any> = {};

              for (const field of allowedFields) {
                if (row != undefined && field in row) {
                  filtered[field] = row[field];
                }
              }

              return filtered;
            });
    } else {
      result = [];
    }
  }

  return { after, result };
};

Compiler.prototype.build_triggers = async function(
  type: "before_triggers" | "after_triggers",
  values: TriggerValues = {},
) {
  const triggers = this[type];
  if (!triggers) return;

  const context: TriggerContext = {
    db: this.db,
    user: this.user,
    role: this.role,
    structure: this.structure,
    options: this.options,
    query: this.query,
    tableMap: this.table_map,
    tableName: this.table_name,
    tableStruct: this.table_structure,
    data: this.data,
    buildWhere: (condition, customData) =>
      this.build_where(condition as WhereCondition, customData).condition,
    resolveCustomValue: (value, customData) =>
      this.resolve_custom_value(value, customData, {
        user: context.user,
        query: context.query,
        table_map: context.tableMap,
        table_name: context.tableName,
      }),
    buildQuery: (query, triggerValues) =>
      new Compiler({
        db: this.db,
        user: this.user,
        role: this.role,
        structure: this.structure,
        options: { ...this.options, disable_triggers: true },
        query,
        before_values: triggerValues.before,
        after_values: triggerValues.after,
        result_values: triggerValues.result,
      }),
  };

  for (const trigger of triggers) {
    this.compiled = {
      ...this.compiled,
      [type]: new Trigger(trigger, context, type, values)
    }
  }
};
