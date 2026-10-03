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
import { resolve_returning_fields, resolveCustomValue } from "../rbac.js";
import { if_condition } from "../old/drizzle.js";

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
  buildQuery: (
    query: StructuredQuery,
    values: TriggerValues,
  ) => Compiler;
};

export class Trigger {
  constructor(
    private readonly definition: TriggerStructure,
    private readonly context: TriggerContext,
  ) {}

  async execute(type: "before_triggers" | "after_triggers", values: TriggerValues): Promise<void> {
    const query = this.definition.query;

    if ("if" in query) {
      const condition = query.if;
      const shouldRun = await if_condition(
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
      await this.executeAction(action, values);
    }

    if ("set" in query) {
      if (type === "after_triggers") {
        throw new Error("Set triggers are only available before the query");
      }
      this.applySet(query.set);
    }

    if ("type" in query) {
      await this.context.buildQuery(query, values).execute();
    }
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
      const value = sql`${resolveCustomValue(
        set.value,
        this.context.user,
        this.context.query,
        this.context.tableMap,
        this.context.tableName,
        row,
      )}`;
      const fallback =
        "else_value" in set
          ? sql`${resolveCustomValue(
              set.else_value,
              this.context.user,
              this.context.query,
              this.context.tableMap,
              this.context.tableName,
              row,
            )}`
          : row[set.field] ?? sql`COALESCE(${value}, '')`;

      row[set.field] = sql`
        CASE
          WHEN ${where} THEN ${value}
          ELSE ${fallback}
        END
      `;
    }
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
  await this.build_triggers(type, values);
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
        resolve_returning_fields(
          this.structure,
          this.returning,
          this.type,
          this.role,
          this.table_name,
          this.table_map,
        ),
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
      this.build_where(condition as WhereCondition, customData),
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
    await new Trigger(trigger, context).execute(type, values);
  }
};
