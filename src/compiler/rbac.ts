import { avg, avgDistinct, count, countDistinct, max, min, sum, sumDistinct } from "drizzle-orm";
import { asc, desc } from "drizzle-orm";
import { Compiler } from "./index.js";
import { WhereCondition, StructuredQuery, type FieldPermission, type SubqueryCondition, Structure, SimpleCondition, ExistsCondition, NotExistsCondition, BetweenCondition, NotBetweenCondition, Table, TRIGGER_CUSTOM_VALUES } from "../types.js";

type CustomValueContext = {
    user: any;
    query: StructuredQuery;
    table_map: Record<string, any>;
    table_name: string;
};

declare module "./index.js" {
  interface Compiler {
    alias_selected_fields(fields: Record<string, any>): Record<string, any>
    extract_table_map(): Record<string, Table>;
    is_allowed_field(entry: string): boolean;
    resolve_fields(fields: string | string[], type: string, default_table: string): Record<string, any>;
    resolve_returning_fields(): Record<string, any>;
    resolve_group_by_fields(): any[];
    resolve_order_by_fields(): any[];
    to_array<T>(value: T | T[] | null | undefined): T[];
    strip_prefixes(input: any): any;
    resolve_data(fields: any): Record<string, any> | Array<Record<string, any>>;
    requests_data(cond: WhereCondition, kind: string): boolean;
    resolve_custom_value(
      value: any,
      custom_value?: Record<string, any>,
      context?: CustomValueContext
    ): any;
  }
}

/* -------------------------------------------------------------------------- */
/*                               RESOLVE FIELDS                               */
/* -------------------------------------------------------------------------- */
Compiler.prototype.alias_selected_fields = function (fields: Record<string, any>): Record<string, any> {
  const aliased: Record<string, any> = {};
  for (const [key, col] of Object.entries(fields)) {
    aliased[key] = col;
  }
  return aliased;
}

Compiler.prototype.is_allowed_field = function(entry:string):boolean {
    let table: string;
    let field: string;

    if (entry.includes(".")) [table, field] = entry.split(".");
    else {
        table = this.table_name;
        field = entry;
    }

    const table_struct = this.structure[table];
    if (!table_struct) throw new Error(`Unknown table '${table}'`);

    const endpoint = table_struct.endpoints.find(e => e.type.toUpperCase() === this.type.toUpperCase());
    if (!endpoint) throw new Error(`${this.type} not allowed on ${table}`);

    const role_permissions = endpoint[this.role];
    if (typeof role_permissions !== "object" || !role_permissions || Array.isArray(role_permissions)) {
        return false;
    }

    const allowed =
        'allowed' in role_permissions
            ? role_permissions.allowed
            : 'allow' in role_permissions
            ? role_permissions.allow
            : [];

    const disallowed =
        'disallowed' in role_permissions
            ? role_permissions.disallowed ?? []
            : 'deny' in role_permissions
            ? role_permissions.deny ?? []
            : [];

    if (!resolve_allowed_fields(field, allowed, disallowed)) {
        console.log("TABLE: ", table)
        console.log("REMOVED: ",field)
        return false
    };
    if (!(field in this.table_map[table])) throw new Error(`Field '${field}' does not exist on table '${table}'`);
    return true
}

type AggregateOp =
    | "COUNT"
    | "COUNTDISTINCT"
    | "SUM"
    | "SUMDISTINCT"
    | "AVG"
    | "AVGDISTINCT"
    | "MIN"
    | "MAX";

interface ParsedField {
    aggregate: AggregateOp | null;
    field: string;
}

const AGGREGATES = new Set<AggregateOp>([
    "COUNT",
    "COUNTDISTINCT",
    "SUM",
    "SUMDISTINCT",
    "AVG",
    "AVGDISTINCT",
    "MIN",
    "MAX",
]);

function apply_aggregate(
    parameter: any,
    aggregate: AggregateOp | null
): any {
    if (!aggregate) return parameter;

    switch (aggregate) {
        case "COUNT":
            return count(parameter);

        case "COUNTDISTINCT":
            return countDistinct(parameter);

        case "SUM":
            return sum(parameter);

        case "SUMDISTINCT":
            return sumDistinct(parameter);

        case "AVG":
            return avg(parameter);

        case "AVGDISTINCT":
            return avgDistinct(parameter);

        case "MIN":
            return min(parameter);

        case "MAX":
            return max(parameter);

        default:
            return parameter;
    }
}

function normalize_op(op: string): string {
    return op
        .trim()
        .replace(/_/g, "")
        .toUpperCase();
}

function get_custom_field(raw_entry: string): ParsedField {
    if (!raw_entry.startsWith("$")) {
        return { aggregate: null, field: raw_entry };
    }

    const dot_index = raw_entry.indexOf(".");

    if (dot_index === -1) {
        return { aggregate: null, field: raw_entry };
    }

    const op_raw = normalize_op(raw_entry.slice(1, dot_index));
    const field = raw_entry.slice(dot_index + 1);

    if (!field) {
        return { aggregate: null, field: raw_entry };
    }

    const op = op_raw as AggregateOp;

    if (AGGREGATES.has(op)) {
        return {
            aggregate: op,
            field,
        };
    }

    return {
        aggregate: null,
        field: raw_entry,
    };
}

Compiler.prototype.resolve_fields = function(
    fields: string | string[],
    type: string,
    default_table: string,
) {
    const allowed_fields: Record<string, any> = {};

    if (!fields) return allowed_fields;

    const entries = Array.isArray(fields) ? fields : [fields];

    for (const raw_entry of entries) {
        let { field: entry, aggregate } = get_custom_field(raw_entry)

        const [table, field] = entry.includes(".")
            ? entry.split(".")
            : [default_table, entry];

        console.log(table)

        const table_struct = this.structure[table];
        if (!table_struct) {
            throw new Error(`Unknown table '${table}'`);
        }

        const endpoint = table_struct.endpoints.find(e => e.type.toUpperCase() === type.toUpperCase());
        if (!endpoint) {
            throw new Error(`${type} not allowed on ${table}`);
        }

        const permissions = endpoint[this.role];

        if (
            !permissions ||
            typeof permissions !== "object" ||
            Array.isArray(permissions)
        ) {
            continue;
        }

        const allowed = permissions.allowed ?? permissions.allow ?? [];
        const disallowed = permissions.disallowed ?? permissions.deny ?? [];

        const table_fields = this.table_map[table];

        const add_field = (field_name: string) => {
            if (!resolve_allowed_fields(field_name, allowed, disallowed)) {
                return;
            }

            const field_ref = table_fields[field_name];

            if (field_ref === undefined) {
                throw new Error(
                    `Field '${field_name}' does not exist on table '${table}'`
                );
            }

            const key = aggregate
                ? `${aggregate}.${table}.${field_name}`
                : `${table}.${field_name}`;

                allowed_fields[key] = apply_aggregate(field_ref, aggregate);
        };

        if (field === "*") {
            for (const field_name in table_fields) {
                add_field(field_name);
            }
        } else {
            add_field(field);
        }
    }

    return allowed_fields;
}

Compiler.prototype.resolve_returning_fields = function() {
    const allowed_fields: Record<string, any> = {};

    if (!this.returning) return allowed_fields;

    const entries = Array.isArray(this.returning) ? this.returning : [this.returning];

    for (const raw_entry of entries) {
        // hard disable count
        const parsed = get_custom_field(raw_entry);

        if (parsed.aggregate) {
            throw new Error(
                `$${parsed.aggregate} fields are disabled in returning`
            );
        }

        const entry = raw_entry;

        const [table, field] = entry.includes(".")
            ? entry.split(".")
            : [this.table_name, entry];

        const table_struct = this.structure[table];
        if (!table_struct) {
            throw new Error(`Unknown table '${table}'`);
        }

        const endpoint = table_struct.endpoints.find(e => e.type.toUpperCase() === this.type.toUpperCase());
        if (!endpoint) {
            throw new Error(`${this.type} not allowed on ${table}`);
        }

        const permissions = endpoint[this.role];

        if (
            !permissions ||
            typeof permissions !== "object" ||
            Array.isArray(permissions)
        ) {
            continue;
        }

        const returning = permissions.returning;

        const table_fields = this.table_map[table];

        if (!table_fields) {
            throw new Error(`Unknown table '${table}' in table_map`);
        }

        // ----------------------------
        // BOOLEAN MODE
        // ----------------------------
        if (typeof returning === "boolean") {
            if (!returning) continue;

            const add_field = (field_name: string) => {
                const field_ref = table_fields[field_name];

                if (field_ref === undefined) {
                    throw new Error(
                        `Field '${field_name}' does not exist on table '${table}'`
                    );
                }

                allowed_fields[field_name] = field_ref;
            };

            if (field === "*") {
                for (const field_name in table_fields) {
                    add_field(field_name);
                }
            } else {
                add_field(field);
            }

            continue;
        }

        // ----------------------------
        // OBJECT MODE
        // ----------------------------
        const allowed = returning?.allowed ?? returning?.allow ?? [];
        const disallowed = returning?.disallowed ?? returning?.deny ?? [];

        const add_field = (field_name: string) => {
            if (
                !resolve_allowed_fields(field_name, allowed, disallowed)
            ) {
                return;
            }

            const field_ref = table_fields[field_name];

            if (field_ref === undefined) {
                throw new Error(
                    `Field '${field_name}' does not exist on table '${table}'`
                );
            }

            allowed_fields[field_name] = field_ref;
        };

        if (field === "*") {
            for (const field_name in table_fields) {
                add_field(field_name);
            }
        } else {
            add_field(field);
        }
    }

    return allowed_fields;
}

Compiler.prototype.resolve_group_by_fields = function() {
  const result: any[] = [];

  const fields = this.to_array(this.group_by)

  if (!fields) return result;

  const list = Array.isArray(fields)
    ? fields
    : typeof fields === "string"
      ? [fields]
      : [];

  const resolve = (entry: string) => {
    if (typeof entry !== "string") return;

    let raw = entry.trim();

    if (raw === "*") {
      throw new Error("'*' not allowed in group_by");
    }

    const parsed = get_custom_field(raw);

    if (parsed.aggregate) {
        throw new Error(
            `$${parsed.aggregate} fields are disabled in returning`
        );
    }

    // -----------------------------
    // resolve table/field
    // -----------------------------
    let table: string;
    let field: string;

    if (raw.includes(".")) {
      [table, field] = raw.split(".");
    } else {
      table = this.table_name;
      field = raw;
    }

    const table_struct = this.structure[table];
    if (!table_struct) throw new Error(`Unknown table '${table}'`);

    const endpoint = table_struct.endpoints.find(e => e.type.toUpperCase() === this.type.toUpperCase());
    if (!endpoint) throw new Error(`${this.type} not allowed on ${table}`);

    const role_permissions = endpoint[this.role];
    if (!role_permissions || typeof role_permissions !== "object") return;

    const allowed =
      "allowed" in role_permissions
        ? role_permissions.allowed
        : role_permissions.allow ?? [];

    const disallowed =
      "disallowed" in role_permissions
        ? role_permissions.disallowed ?? []
        : role_permissions.deny ?? [];

    // -----------------------------
    // permission check
    // -----------------------------
    if (!resolve_allowed_fields(field, allowed, disallowed)) {
      return;
    }

    // -----------------------------
    // existence check
    // -----------------------------
    const column = this.table_map[table]?.[field];
    if (!column) {
      throw new Error(`Invalid group_by column: ${table}.${field}`);
    }

    result.push(column);
  }

  for (const f of list) resolve(f);

  return result;
}

Compiler.prototype.resolve_order_by_fields = function() {
    const resolved_fields: any[] = [];

    const fields = this.to_array(this.order_by);

    if (!fields || (typeof fields !== "string" && !Array.isArray(fields))) {
        return resolved_fields;
    }

    const keys = Array.isArray(fields) ? fields : [fields];

    const resolve_field =(entry: string) => {
        if (typeof entry !== "string") return;

        let direction: "ASC" | "DESC" = "ASC";
        let raw = entry.trim();

        // -----------------------------------
        // Parse direction prefix
        // -----------------------------------

        if (raw.startsWith("$desc.")) {
            direction = "DESC";
            raw = raw.slice(6);
        } else if (raw.startsWith("$asc.")) {
            direction = "ASC";
            raw = raw.slice(5);
        }

        // -----------------------------------
        // Remove unsupported syntax
        // -----------------------------------

        if (raw === "*") {
            throw new Error(`'*' is not allowed in order_by`);
        }

        const parsed = get_custom_field(raw);

        if (parsed.aggregate) {
            throw new Error(
                `$${parsed.aggregate} fields are disabled in returning`
            );
        }

        // -----------------------------------
        // Resolve table + field
        // -----------------------------------

        let table: string;
        let field: string;

        if (raw.includes(".")) {
            [table, field] = raw.split(".");
        } else {
            table = this.table_name;
            field = raw;
        }

        // -----------------------------------
        // Validate table
        // -----------------------------------

        const table_struct = this.structure[table];

        if (!table_struct) {
            throw new Error(`Unknown table '${table}'`);
        }

        // -----------------------------------
        // Validate endpoint
        // -----------------------------------

        const endpoint = table_struct.endpoints.find(
            (e) => e.type.toUpperCase() === this.type.toUpperCase()
        );

        if (!endpoint) {
            throw new Error(`${this.type} not allowed on ${table}`);
        }

        // -----------------------------------
        // Validate role permissions
        // -----------------------------------

        const role_permissions = endpoint[this.role];

        if (
            typeof role_permissions !== "object" ||
            !role_permissions ||
            Array.isArray(role_permissions)
        ) {
            return;
        }

        const allowed =
            "allowed" in role_permissions
                ? role_permissions.allowed
                : "allow" in role_permissions
                ? role_permissions.allow
                : [];

        const disallowed =
            "disallowed" in role_permissions
                ? role_permissions.disallowed ?? []
                : "deny" in role_permissions
                ? role_permissions.deny ?? []
                : [];

        // -----------------------------------
        // Validate field permissions
        // -----------------------------------

        if (
            !resolve_allowed_fields(
                field,
                allowed,
                disallowed
            )
        ) {
            return;
        }

        // -----------------------------------
        // Validate field existence
        // -----------------------------------

        if (!(field in this.table_map[table])) {
            throw new Error(
                `Field '${field}' does not exist on table '${table}'`
            );
        }

        const field_reference = this.table_map[table][field];

        // -----------------------------------
        // Build drizzle order expression
        // -----------------------------------

        resolved_fields.push(
            direction === "DESC"
                ? desc(field_reference)
                : asc(field_reference)
        );
    }

    for (const entry of keys) {
        resolve_field(entry);
    }

    return resolved_fields;
}

Compiler.prototype.to_array = function<T>(v: T | T[] | null | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function matches_field(field: string, rule: string): boolean {
	if (rule === "*") return true;
	return rule === field;
}

function matches_permission(
	field: string,
	permission?: FieldPermission
): boolean {
	if (!permission) return false;

	if (typeof permission === "string") {
		return matches_field(field, permission);
	}

	if (Array.isArray(permission)) {
		return permission.some(rule => matches_field(field, rule));
	}

	if (typeof permission === "object") {
		const rule = permission.field;

		if (Array.isArray(rule)) {
			return rule.some(r => matches_field(field, r));
		}

		return matches_field(field, rule);
	}

	return false;
}

function resolve_allowed_fields(
	field: string,
	allowed?: FieldPermission,
	disallowed?: FieldPermission
): boolean {
	// Field must match allowed rules
	const allowed_match = matches_permission(field, allowed);

	if (!allowed_match) {
		return false;
	}

	// Field must NOT match disallowed rules
	const disallowed_match = matches_permission(field, disallowed);

	if (disallowed_match) {
		return false;
	}

	return true;
}

/* -------------------------------------------------------------------------- */
/*                   REMOVE PREFIXES FROM RETURNED STRUCTURE                  */
/* -------------------------------------------------------------------------- */
Compiler.prototype.strip_prefixes = function(input: any) {
    // * Handle arrays
    if (Array.isArray(input)) {
        return input.map((value)=>{this.strip_prefixes(value)});
    }

    // * Handle objects (but not null)
    if (input !== null && typeof input === "object") {
        const cleaned: Record<string, any> = {};

        for (const [key, value] of Object.entries(input)) {
            let clean_key = key.includes(".") ? key.split(".").pop()! : key;
            if (Object.prototype.hasOwnProperty.call(cleaned, clean_key)) {
                clean_key = key.includes(".") ? key.replace(".", "_") : `${key}_${value}`;
            }
            cleaned[clean_key] = this.strip_prefixes(value);
        }

        return cleaned;
    }

    // * Primitives (string, number, boolean, null, undefined)
    return input;
}

/* -------------------------------------------------------------------------- */
/*                                DATA RESOLVE                                */
/* -------------------------------------------------------------------------- */
// * Simply checks if value passed is undefined
function is_undefined(v: any) {
    if (v === undefined) throw new Error(`Undefined value not supported`);
    return v;
}

function escape_regex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function is_data_ref(value: unknown, kind: string): boolean {
  const safe_kind = escape_regex(kind);
  const DATA_REF_REGEX = new RegExp(`^\\$(${safe_kind})\\.(.+)$`);

  return typeof value === "string" && DATA_REF_REGEX.test(value);
}

function check_object(obj: Record<string, any>, kind: string): boolean {
  return Object.values(obj).some((value) =>
    is_data_ref(value, kind)
  );
}

function get_endpoint(structure: Structure, table: string, type: string) {
  const table_struct = structure[table];
  if (!table_struct) throw new Error(`Unknown table '${table}'`);

  const endpoint = table_struct.endpoints.find(
    (e) => e.type.toUpperCase() === type.toUpperCase()
  );

  if (!endpoint) throw new Error(`${type} not allowed on ${table}`);

  return endpoint;
}

function get_permissions(endpoint: any, role: string) {
  const role_permissions = endpoint[role];

  if (
    !role_permissions ||
    typeof role_permissions !== "object" ||
    Array.isArray(role_permissions)
  ) {
    return null;
  }

  return {
    allowed:
      "allowed" in role_permissions
        ? role_permissions.allowed
        : "allow" in role_permissions
        ? role_permissions.allow
        : [],

    disallowed:
      "disallowed" in role_permissions
        ? role_permissions.disallowed ?? []
        : "deny" in role_permissions
        ? role_permissions.deny ?? []
        : [],
  };
}

function resolve_col_ref(
  col_ref: string,
  default_table: string,
  table_map: Record<string, Record<string, any>>
) {
  const parts = col_ref.split(".");

  let table: string;
  let field: string;

  if (parts.length === 2) {
    [table, field] = parts;
  } else if (parts.length === 1) {
    if (!default_table) {
      throw new Error(
        `Column '${col_ref}' missing table and no default_table provided`
      );
    }
    table = default_table;
    field = parts[0];
  } else {
    throw new Error(`Invalid $col format: '${col_ref}'`);
  }

  if (!table_map[table] || !(field in table_map[table])) {
    throw new Error(`Field '${field}' does not exist on table '${table}'`);
  }

  return { table, field };
}

Compiler.prototype.resolve_data = function(fields: any): Record<string, any> | Array<Record<string, any>> {

    if (Array.isArray(fields)) {
        return fields.flatMap((item) =>
            this.resolve_data(item)
        );
    }

    if (!fields || typeof fields !== "object") {
        return {};
    }

    const normalized_before = Array.isArray(this.before_values)
        ? this.before_values
        : this.before_values !== undefined
            ? [this.before_values]
            : [];

    const normalized_after = Array.isArray(this.after_values)
        ? this.after_values
        : this.after_values !== undefined
            ? [this.after_values]
            : [];

    const normalized_result = Array.isArray(this.result_values)
        ? this.result_values
        : this.result_values !== undefined
            ? [this.result_values]
            : [];

    const max_values = Math.max(
        normalized_before.length,
        normalized_after.length,
        normalized_result.length,
        1
    );

    let results: Record<string, any>[] = Array.from(
        { length: max_values },
        () => ({})
    );

    for (const [entry, value] of Object.entries(fields)) {
        const [raw_table, raw_field] = entry.includes(".")
            ? entry.split(".")
            : [this.table_name, entry];

        const table = raw_table;
        const field = raw_field;

        // schema validation
        if (!this.table_map[table] || !(field in this.table_map[table])) {
            throw new Error(
                `Field '${field}' does not exist on table '${table}'`
            );
        }

        // endpoint + permissions
        const endpoint = get_endpoint(this.structure, table, this.type);
        const permissions = get_permissions(endpoint, this.role);

        if (!permissions) continue;

        const { allowed, disallowed } = permissions;

        if (!resolve_allowed_fields(field, allowed, disallowed)) {
            continue;
        }

        // $col validation
        if (typeof value === "string" && value.startsWith("$col.")) {
            const col_ref = value.slice(5);

            const { table: v_tbl, field: v_col } = resolve_col_ref(
                col_ref,
                this.table_name,
                this.table_map
            );

            const v_endpoint = get_endpoint(this.structure, v_tbl, this.type);
            const v_permissions = get_permissions(v_endpoint, this.role);

            if (!v_permissions) continue;

            if (
                !resolve_allowed_fields(
                    v_col,
                    v_permissions.allowed,
                    v_permissions.disallowed
                )
            ) {
                continue;
            }
        }


        // Handle dynamic values
        if (is_data_ref(value, "before")) {
            results = results.map((item, index) => ({
                ...item,
                [entry]: this.resolve_custom_value(value, normalized_before[index]) ?? null
            }));

        } else if (is_data_ref(value, "after")) {
            results = results.map((item, index) => ({
                ...item,
                [entry]: this.resolve_custom_value(value, normalized_after[index]) ?? null
            }));

        } else if (is_data_ref(value, "result")) {
            results = results.map((item, index) => ({
                ...item,
                [entry]: this.resolve_custom_value(value, normalized_result[index]) ?? null
            }));

        } else {
            results = results.map((item) => ({
                ...item,
                [entry]: this.resolve_custom_value(value)
            }));
        }
    }

    return results.length === 1
        ? results[0]
        : results;
}

Compiler.prototype.requests_data = function(cond: WhereCondition, kind: string): boolean {
    return Object.entries(cond).some(([_, value]) => {
        if (typeof value === "string") {
            return is_data_ref(value, kind);
        }

        if (value && typeof value === "object") {
            return check_object(value, kind);
        }

        return false;
    });
}

// * Resolves custom values ex. $data - $user $col
Compiler.prototype.resolve_custom_value = function(
  value: any,
  custom_value?: Record<string, any>,
  context?: CustomValueContext,
): any {
    const user = context ? context.user : this.user;
    const query = context ? context.query : this.query;
    const table_map = context ? context.table_map : this.table_map;
    const table_name = context ? context.table_name : this.table_name;

    if (!value) return value;

    const resolve_path = (
        source: Record<string, any> | undefined,
        key: string
    ) => {
        if (!source) return undefined;

        // direct match
        if (key in source) {
            return is_undefined(source[key]);
        }

        // nested match
        let val: any = source;

        for (const part of key.split(".")) {
            if (
                val &&
                typeof val === "object" &&
                part in val
            ) {
                val = val[part];
            } else {
                return undefined;
            }
        }

        return is_undefined(val);
    };

    // ------------------------
    // Handle object: $col.X
    // ------------------------
    let match = typeof value === "string" && value.match(/^\$col\.(.+)$/);

    if (match) {
        const col_ref = match[1];

        if (!table_map) {
            throw new Error(`table_map is required to resolve $col`);
        }

        const parts = col_ref.split(".");

        let v_tbl: string;
        let v_col: string;

        if (parts.length === 2) {
            [v_tbl, v_col] = parts;
        } else if (parts.length === 1) {
            if (!table_name) {
                throw new Error(
                    `Column '${col_ref}' missing table and no default_table_name provided`
                );
            }
            v_tbl = table_name;
            v_col = parts[0];
        } else {
            throw new Error(`Invalid $col format: '${value}'`);
        }

        const v_column = table_map[v_tbl]?.[v_col];

        if (!v_column) {
            throw new Error(`Column '${col_ref}' not found`);
        }

        return v_column;
    }

    // ------------------------
    // Non-string → return as-is
    // ------------------------
    if (typeof value !== "string") return value;

    // ------------------------
    // $user.X
    // ------------------------
    match = value.match(/^\$user\.(\w+)$/);
    if (match && user) {
        return is_undefined(user[match[1]]);
    }

    // ------------------------
    // $data.X / $before.X / $after.X / $result.X
    // ------------------------
    match = value.match(/^\$(data|before|after|result)\.(.+)$/);

    if (match) {
        const [, scope, key] = match;
        const trigger_values = custom_value?.[TRIGGER_CUSTOM_VALUES] as
            | Record<string, Record<string, any> | undefined>
            | undefined;

        const source =
            scope === "data"
                ? (
                    trigger_values?.data ??
                    (custom_value && !Array.isArray(custom_value)
                        ? custom_value
                        : undefined) ??
                    (query?.data && !Array.isArray(query.data)
                        ? query.data
                        : undefined)
                )
                : (
                    trigger_values?.[scope] ??
                    (custom_value && !Array.isArray(custom_value)
                        ? custom_value
                        : undefined)
                );

        const resolved = resolve_path(source, key);

        return resolved;

        // Commented as not passed data but requested on RBAC can cause failed queries also if are correct
        // throw new Error(`match not found with passed value: ${value}`);
    }

    // ------------------------
    // fallback
    // ------------------------
    return is_undefined(value);
}

// * checks operator type
type ConditionWithOperator<T extends string> =
  | { operator: T }
  | { op: T }

export function is_op_type<T extends string>(
  condition:
    | SimpleCondition
    | ExistsCondition
    | NotExistsCondition
    | BetweenCondition
    | NotBetweenCondition,
  text: T
): condition is Extract<
  SimpleCondition | ExistsCondition | NotExistsCondition | BetweenCondition | NotBetweenCondition,
  ConditionWithOperator<T>
> {
  return (
    condition.operator?.toUpperCase() === text.toUpperCase() ||
    condition.op?.toUpperCase() === text.toUpperCase()
  )
}

Compiler.prototype.extract_table_map = function(): Record<string, Table> {
  return Object.fromEntries(
    Object.entries(this.structure).map(([key, value]) => [key, value.table])
  );
}