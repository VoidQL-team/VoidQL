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

/* -------------------------------------------------------------------------- */
/*                         TRIGGER TYPES & ACTIONS                            */
/* -------------------------------------------------------------------------- */

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
  table_map: Record<string, any>;
  table_name: string;
  table_struct: TableStructure;
  data?: Record<string, any> | Record<string, any>[];
  build_where: (
    condition: WhereCondition | SubqueryCondition,
    custom_data?: Record<string, any>,
  ) => any;
  resolve_custom_value: (
    value: any,
    custom_data?: Record<string, any>,
  ) => any;
  build_query: (
    query: StructuredQuery,
    values: TriggerValues,
  ) => Compiler;
  evaluate_condition: (
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
        const should_run = await this.context.evaluate_condition(
          condition.when,
          values,
        );
        await this.execute_action(
          should_run ? condition.do : condition.else,
          values,
        );
      };
    } else if ("set" in query) {
      if (type === "after_triggers") {
        throw new Error("Set triggers are only available before the query");
      }
      this.action = async () => this.apply_set(query.set);
    } else if ("type" in query) {
      this.action = async (values) =>
        this.context.build_query(query, values).execute();
    }
  }

  async execute(values: TriggerValues): Promise<any[] | undefined | void | null> {
    if(this.action) return await this.action(values)
    else return null
  }

  private async execute_action(
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
        .build_query(action as StructuredQuery, values)
        .execute();
    }
  }

  private apply_set(set: SetCondition): void {
    const data = this.context.data;
    if (!data) {
      throw new Error("Cannot apply set trigger without target data");
    }

    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const where = this.context.build_where(set.when, row);
      const value = sql`${this.context.resolve_custom_value(set.value, row)}`;
      const fallback =
        "else_value" in set
          ? sql`${this.context.resolve_custom_value(set.else_value, row)}`
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

/* -------------------------------------------------------------------------- */
/*                            TRIGGER LIFECYCLE                               */
/* -------------------------------------------------------------------------- */

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
      const allowed_fields = Object.keys(
        this.resolve_returning_fields(),
      );

      result =
        allowed_fields.length === 0
          ? []
          : (after ?? []).map((row: Record<string, any>) => {
              const filtered: Record<string, any> = {};

              for (const field of allowed_fields) {
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
    table_map: this.table_map,
    table_name: this.table_name,
    table_struct: this.table_structure,
    data: this.data,
    build_where: (condition, custom_data) =>
      this.build_where(condition as WhereCondition, custom_data).condition,
    evaluate_condition: async (condition, values) => {
      if (typeof condition === "boolean") return condition;

      const scopes = {
        before: values.before,
        after: values.after,
        result: values.result,
        data: this.data,
      };
      const referenced_scopes = Object.entries(scopes)
        .filter(([scope]) =>
          this.requests_data(condition as WhereCondition, scope),
        );
      const row_count = referenced_scopes.length > 0
        ? Math.max(
            ...referenced_scopes.map(([, value]) =>
              Array.isArray(value) ? value.length : value === undefined ? 0 : 1,
            ),
          )
        : 1;
      if (row_count === 0) return false;

      const rows = Array.from({ length: row_count }, (_, index) => ({
        [TRIGGER_CUSTOM_VALUES]: Object.fromEntries(
          referenced_scopes.map(([scope, value]) => [
            scope,
            Array.isArray(value) ? value[index] : value,
          ]),
        ),
      }));
      const built_conditions = rows.map((row) =>
        this.build_where(condition as WhereCondition, row),
      );
      const where = rows.length > 1
        ? this.and(built_conditions.map((built) => built.condition))
        : built_conditions[0].condition;
      const needs_table = built_conditions.some((built) => built.needs_table);
      const compiled = this.compile_condition_query(where, needs_table);
      const output = await compiled.execute();
      const first_result = Array.isArray(output) ? output[0] : output;
      const result_row = Array.isArray(first_result) ? first_result[0] : first_result;
      return Boolean(result_row?.result ?? 0);
    },
    resolve_custom_value: (value, custom_data) =>
      this.resolve_custom_value(value, custom_data, {
        user: context.user,
        query: context.query,
        table_map: context.table_map,
        table_name: context.table_name,
      }),
    build_query: (query, trigger_values) =>
      new Compiler({
        db: this.db,
        user: this.user,
        role: this.role,
        structure: this.structure,
        options: { ...this.options, disable_triggers: true },
        query,
        before_values: trigger_values.before,
        after_values: trigger_values.after,
        result_values: trigger_values.result,
      }),
  };

  this.compiled = {
    ...this.compiled,
    [type]: triggers.map((trigger) => new Trigger(trigger, context, type)),
  };
};
