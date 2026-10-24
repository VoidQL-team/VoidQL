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
  TRIGGER_CUSTOM_VALUES,
} from "../types.js";

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
  evaluateCondition: (
    condition: WhereCondition | SubqueryCondition,
    values: TriggerValues,
  ) => Promise<boolean>;
};

export class Trigger {
  private action: null | ((values: TriggerValues) => Promise<any>) = null;
  constructor(
    private readonly definition: TriggerStructure,
    private readonly context: TriggerContext,
    type: "before_triggers" | "after_triggers",
  ) {
    const query = this.definition.query;

    if ("if" in query) {
      const condition = query.if;
      this.action = async (values) => {
        const shouldRun = await this.context.evaluateCondition(
          condition.when,
          values,
        );
        await this.executeAction(
          shouldRun ? condition.do : condition.else,
          values,
        );
      };
    } else if ("set" in query) {
      if (type === "after_triggers") {
        throw new Error("Set triggers are only available before the query");
      }
      this.action = async () => this.applySet(query.set);
    } else if ("type" in query) {
      this.action = async (values) =>
        this.context.buildQuery(query, values).execute();
    }
  }

  async execute(values: TriggerValues): Promise<any[] | undefined | void | null> {
    if(this.action) return await this.action(values)
    else return null
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
    ): void;
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
  this.build_triggers("before_triggers");
  this.build_triggers("after_triggers");
};

Compiler.prototype.execute_triggers = async function(
  type: "before_triggers" | "after_triggers",
  values: TriggerValues = {},
) {
  if(this.compiled && this.compiled[type]) {
    const triggers = this.compiled[type]
    for(const trigger of triggers) {
      await trigger.execute(values)
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

Compiler.prototype.build_triggers = function(
  type: "before_triggers" | "after_triggers",
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
    evaluateCondition: async (condition, values) => {
      if (typeof condition === "boolean") return condition;

      const scopes = {
        before: values.before,
        after: values.after,
        result: values.result,
        data: this.data,
      };
      const referencedScopes = Object.entries(scopes)
        .filter(([scope]) =>
          this.requests_data(condition as WhereCondition, scope),
        );
      const rowCount = referencedScopes.length > 0
        ? Math.max(
            ...referencedScopes.map(([, value]) =>
              Array.isArray(value) ? value.length : value === undefined ? 0 : 1,
            ),
          )
        : 1;
      if (rowCount === 0) return false;

      const rows = Array.from({ length: rowCount }, (_, index) => ({
        [TRIGGER_CUSTOM_VALUES]: Object.fromEntries(
          referencedScopes.map(([scope, value]) => [
            scope,
            Array.isArray(value) ? value[index] : value,
          ]),
        ),
      }));
      const builtConditions = rows.map((row) =>
        this.build_where(condition as WhereCondition, row),
      );
      const where = rows.length > 1
        ? this.and(builtConditions.map((built) => built.condition))
        : builtConditions[0].condition;
      const needsTable = builtConditions.some((built) => built.needs_table);
      const compiled = this.compile_condition_query(where, needsTable);
      const output = await compiled.execute();
      const firstResult = Array.isArray(output) ? output[0] : output;
      const resultRow = Array.isArray(firstResult) ? firstResult[0] : firstResult;
      return Boolean(resultRow?.result ?? 0);
    },
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

  this.compiled = {
    ...this.compiled,
    [type]: triggers.map((trigger) => new Trigger(trigger, context, type)),
  };
};
