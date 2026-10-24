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

    const tableStruct = this.structure[table];
    if (!tableStruct) throw new Error(`Unknown table '${table}'`);

    const endpoint = tableStruct.endpoints.find(e => e.type.toUpperCase() === this.type.toUpperCase());
    if (!endpoint) throw new Error(`${this.type} not allowed on ${table}`);

    const rolePermissions = endpoint[this.role];
    if (typeof rolePermissions !== "object" || !rolePermissions || Array.isArray(rolePermissions)) {
        return false;
    }

    const allowed =
        'allowed' in rolePermissions
            ? rolePermissions.allowed
            : 'allow' in rolePermissions
            ? rolePermissions.allow
            : [];

    const disallowed =
        'disallowed' in rolePermissions
            ? rolePermissions.disallowed ?? []
            : 'deny' in rolePermissions
            ? rolePermissions.deny ?? []
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

function normalizeOp(op: string): string {
    return op
        .trim()
        .replace(/_/g, "")
        .toUpperCase();
}

function get_custom_field(rawEntry: string): ParsedField {
    if (!rawEntry.startsWith("$")) {
        return { aggregate: null, field: rawEntry };
    }

    const dotIndex = rawEntry.indexOf(".");

    if (dotIndex === -1) {
        return { aggregate: null, field: rawEntry };
    }

    const opRaw = normalizeOp(rawEntry.slice(1, dotIndex));
    const field = rawEntry.slice(dotIndex + 1);

    if (!field) {
        return { aggregate: null, field: rawEntry };
    }

    const op = opRaw as AggregateOp;

    if (AGGREGATES.has(op)) {
        return {
            aggregate: op,
            field,
        };
    }

    return {
        aggregate: null,
        field: rawEntry,
    };
}

Compiler.prototype.resolve_fields = function(
    fields: string | string[],
    type: string,
    default_table: string,
) {
    const allowedFields: Record<string, any> = {};

    if (!fields) return allowedFields;

    const entries = Array.isArray(fields) ? fields : [fields];

    for (const rawEntry of entries) {
        let { field: entry, aggregate } = get_custom_field(rawEntry)

        const [table, field] = entry.includes(".")
            ? entry.split(".")
            : [default_table, entry];

        console.log(table)

        const tableStruct = this.structure[table];
        if (!tableStruct) {
            throw new Error(`Unknown table '${table}'`);
        }

        const endpoint = tableStruct.endpoints.find(e => e.type.toUpperCase() === type.toUpperCase());
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

        const tableFields = this.table_map[table];

        const addField = (fieldName: string) => {
            if (!resolve_allowed_fields(fieldName, allowed, disallowed)) {
                return;
            }

            const fieldRef = tableFields[fieldName];

            if (fieldRef === undefined) {
                throw new Error(
                    `Field '${fieldName}' does not exist on table '${table}'`
                );
            }

            const key = aggregate
                ? `${aggregate}.${table}.${fieldName}`
                : `${table}.${fieldName}`;

                allowedFields[key] = apply_aggregate(fieldRef, aggregate);
        };

        if (field === "*") {
            for (const fieldName in tableFields) {
                addField(fieldName);
            }
        } else {
            addField(field);
        }
    }

    return allowedFields;
}

Compiler.prototype.resolve_returning_fields = function() {
    const allowedFields: Record<string, any> = {};

    if (!this.returning) return allowedFields;

    const entries = Array.isArray(this.returning) ? this.returning : [this.returning];

    for (const rawEntry of entries) {
        // hard disable count
        const parsed = get_custom_field(rawEntry);

        if (parsed.aggregate) {
            throw new Error(
                `$${parsed.aggregate} fields are disabled in returning`
            );
        }

        const entry = rawEntry;

        const [table, field] = entry.includes(".")
            ? entry.split(".")
            : [this.table_name, entry];

        const tableStruct = this.structure[table];
        if (!tableStruct) {
            throw new Error(`Unknown table '${table}'`);
        }

        const endpoint = tableStruct.endpoints.find(e => e.type.toUpperCase() === this.type.toUpperCase());
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

        const tableFields = this.table_map[table];

        if (!tableFields) {
            throw new Error(`Unknown table '${table}' in tableMap`);
        }

        // ----------------------------
        // BOOLEAN MODE
        // ----------------------------
        if (typeof returning === "boolean") {
            if (!returning) continue;

            const addField = (fieldName: string) => {
                const fieldRef = tableFields[fieldName];

                if (fieldRef === undefined) {
                    throw new Error(
                        `Field '${fieldName}' does not exist on table '${table}'`
                    );
                }

                allowedFields[fieldName] = fieldRef;
            };

            if (field === "*") {
                for (const fieldName in tableFields) {
                    addField(fieldName);
                }
            } else {
                addField(field);
            }

            continue;
        }

        // ----------------------------
        // OBJECT MODE
        // ----------------------------
        const allowed = returning?.allowed ?? returning?.allow ?? [];
        const disallowed = returning?.disallowed ?? returning?.deny ?? [];

        const addField = (fieldName: string) => {
            if (
                !resolve_allowed_fields(fieldName, allowed, disallowed)
            ) {
                return;
            }

            const fieldRef = tableFields[fieldName];

            if (fieldRef === undefined) {
                throw new Error(
                    `Field '${fieldName}' does not exist on table '${table}'`
                );
            }

            allowedFields[fieldName] = fieldRef;
        };

        if (field === "*") {
            for (const fieldName in tableFields) {
                addField(fieldName);
            }
        } else {
            addField(field);
        }
    }

    return allowedFields;
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

    const tableStruct = this.structure[table];
    if (!tableStruct) throw new Error(`Unknown table '${table}'`);

    const endpoint = tableStruct.endpoints.find(e => e.type.toUpperCase() === this.type.toUpperCase());
    if (!endpoint) throw new Error(`${this.type} not allowed on ${table}`);

    const rolePermissions = endpoint[this.role];
    if (!rolePermissions || typeof rolePermissions !== "object") return;

    const allowed =
      "allowed" in rolePermissions
        ? rolePermissions.allowed
        : rolePermissions.allow ?? [];

    const disallowed =
      "disallowed" in rolePermissions
        ? rolePermissions.disallowed ?? []
        : rolePermissions.deny ?? [];

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

        const tableStruct = this.structure[table];

        if (!tableStruct) {
            throw new Error(`Unknown table '${table}'`);
        }

        // -----------------------------------
        // Validate endpoint
        // -----------------------------------

        const endpoint = tableStruct.endpoints.find(
            (e) => e.type.toUpperCase() === this.type.toUpperCase()
        );

        if (!endpoint) {
            throw new Error(`${this.type} not allowed on ${table}`);
        }

        // -----------------------------------
        // Validate role permissions
        // -----------------------------------

        const rolePermissions = endpoint[this.role];

        if (
            typeof rolePermissions !== "object" ||
            !rolePermissions ||
            Array.isArray(rolePermissions)
        ) {
            return;
        }

        const allowed =
            "allowed" in rolePermissions
                ? rolePermissions.allowed
                : "allow" in rolePermissions
                ? rolePermissions.allow
                : [];

        const disallowed =
            "disallowed" in rolePermissions
                ? rolePermissions.disallowed ?? []
                : "deny" in rolePermissions
                ? rolePermissions.deny ?? []
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

function matchesField(field: string, rule: string): boolean {
	if (rule === "*") return true;
	return rule === field;
}

function matchesPermission(
	field: string,
	permission?: FieldPermission
): boolean {
	if (!permission) return false;

	if (typeof permission === "string") {
		return matchesField(field, permission);
	}

	if (Array.isArray(permission)) {
		return permission.some(rule => matchesField(field, rule));
	}

	if (typeof permission === "object") {
		const rule = permission.field;

		if (Array.isArray(rule)) {
			return rule.some(r => matchesField(field, r));
		}

		return matchesField(field, rule);
	}

	return false;
}

function resolve_allowed_fields(
	field: string,
	allowed?: FieldPermission,
	disallowed?: FieldPermission
): boolean {
	// Field must match allowed rules
	const allowedMatch = matchesPermission(field, allowed);

	if (!allowedMatch) {
		return false;
	}

	// Field must NOT match disallowed rules
	const disallowedMatch = matchesPermission(field, disallowed);

	if (disallowedMatch) {
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
            let cleanKey = key.includes(".") ? key.split(".").pop()! : key;
            if (Object.prototype.hasOwnProperty.call(cleaned, cleanKey)) {
                cleanKey = key.includes(".") ? key.replace(".", "_") : `${key}_${value}`;
            }
            cleaned[cleanKey] = this.strip_prefixes(value);
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

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDataRef(value: unknown, kind: string): boolean {
  const safeKind = escapeRegex(kind);
  const DATA_REF_REGEX = new RegExp(`^\\$(${safeKind})\\.(.+)$`);

  return typeof value === "string" && DATA_REF_REGEX.test(value);
}

function checkObject(obj: Record<string, any>, kind: string): boolean {
  return Object.values(obj).some((value) =>
    isDataRef(value, kind)
  );
}

function getEndpoint(structure: Structure, table: string, type: string) {
  const tableStruct = structure[table];
  if (!tableStruct) throw new Error(`Unknown table '${table}'`);

  const endpoint = tableStruct.endpoints.find(
    (e) => e.type.toUpperCase() === type.toUpperCase()
  );

  if (!endpoint) throw new Error(`${type} not allowed on ${table}`);

  return endpoint;
}

function getPermissions(endpoint: any, role: string) {
  const rolePermissions = endpoint[role];

  if (
    !rolePermissions ||
    typeof rolePermissions !== "object" ||
    Array.isArray(rolePermissions)
  ) {
    return null;
  }

  return {
    allowed:
      "allowed" in rolePermissions
        ? rolePermissions.allowed
        : "allow" in rolePermissions
        ? rolePermissions.allow
        : [],

    disallowed:
      "disallowed" in rolePermissions
        ? rolePermissions.disallowed ?? []
        : "deny" in rolePermissions
        ? rolePermissions.deny ?? []
        : [],
  };
}

function resolveColRef(
  colRef: string,
  default_table: string,
  tableMap: Record<string, Record<string, any>>
) {
  const parts = colRef.split(".");

  let table: string;
  let field: string;

  if (parts.length === 2) {
    [table, field] = parts;
  } else if (parts.length === 1) {
    if (!default_table) {
      throw new Error(
        `Column '${colRef}' missing table and no default_table provided`
      );
    }
    table = default_table;
    field = parts[0];
  } else {
    throw new Error(`Invalid $col format: '${colRef}'`);
  }

  if (!tableMap[table] || !(field in tableMap[table])) {
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

    const normalizedBefore = Array.isArray(this.before_values)
        ? this.before_values
        : this.before_values !== undefined
            ? [this.before_values]
            : [];

    const normalizedAfter = Array.isArray(this.after_values)
        ? this.after_values
        : this.after_values !== undefined
            ? [this.after_values]
            : [];

    const normalizedResult = Array.isArray(this.result_values)
        ? this.result_values
        : this.result_values !== undefined
            ? [this.result_values]
            : [];

    const maxValues = Math.max(
        normalizedBefore.length,
        normalizedAfter.length,
        normalizedResult.length,
        1
    );

    let results: Record<string, any>[] = Array.from(
        { length: maxValues },
        () => ({})
    );

    for (const [entry, value] of Object.entries(fields)) {
        const [rawTable, rawField] = entry.includes(".")
            ? entry.split(".")
            : [this.table_name, entry];

        const table = rawTable;
        const field = rawField;

        // schema validation
        if (!this.table_map[table] || !(field in this.table_map[table])) {
            throw new Error(
                `Field '${field}' does not exist on table '${table}'`
            );
        }

        // endpoint + permissions
        const endpoint = getEndpoint(this.structure, table, this.type);
        const permissions = getPermissions(endpoint, this.role);

        if (!permissions) continue;

        const { allowed, disallowed } = permissions;

        if (!resolve_allowed_fields(field, allowed, disallowed)) {
            continue;
        }

        // $col validation
        if (typeof value === "string" && value.startsWith("$col.")) {
            const colRef = value.slice(5);

            const { table: vTbl, field: vCol } = resolveColRef(
                colRef,
                this.table_name,
                this.table_map
            );

            const vEndpoint = getEndpoint(this.structure, vTbl, this.type);
            const vPermissions = getPermissions(vEndpoint, this.role);

            if (!vPermissions) continue;

            if (
                !resolve_allowed_fields(
                    vCol,
                    vPermissions.allowed,
                    vPermissions.disallowed
                )
            ) {
                continue;
            }
        }


        // Handle dynamic values
        if (isDataRef(value, "before")) {
            results = results.map((item, index) => ({
                ...item,
                [entry]: this.resolve_custom_value(value, normalizedBefore[index]) ?? null
            }));

        } else if (isDataRef(value, "after")) {
            results = results.map((item, index) => ({
                ...item,
                [entry]: this.resolve_custom_value(value, normalizedAfter[index]) ?? null
            }));

        } else if (isDataRef(value, "result")) {
            results = results.map((item, index) => ({
                ...item,
                [entry]: this.resolve_custom_value(value, normalizedResult[index]) ?? null
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
            return isDataRef(value, kind);
        }

        if (value && typeof value === "object") {
            return checkObject(value, kind);
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

    const resolvePath = (
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
        const colRef = match[1];

        if (!table_map) {
            throw new Error(`tableMap is required to resolve $col`);
        }

        const parts = colRef.split(".");

        let vTbl: string;
        let vCol: string;

        if (parts.length === 2) {
            [vTbl, vCol] = parts;
        } else if (parts.length === 1) {
            if (!table_name) {
                throw new Error(
                    `Column '${colRef}' missing table and no default_table_name provided`
                );
            }
            vTbl = table_name;
            vCol = parts[0];
        } else {
            throw new Error(`Invalid $col format: '${value}'`);
        }

        const vColumn = table_map[vTbl]?.[vCol];

        if (!vColumn) {
            throw new Error(`Column '${colRef}' not found`);
        }

        return vColumn;
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
        const triggerValues = custom_value?.[TRIGGER_CUSTOM_VALUES] as
            | Record<string, Record<string, any> | undefined>
            | undefined;

        const source =
            scope === "data"
                ? (
                    triggerValues?.data ??
                    (custom_value && !Array.isArray(custom_value)
                        ? custom_value
                        : undefined) ??
                    (query?.data && !Array.isArray(query.data)
                        ? query.data
                        : undefined)
                )
                : (
                    triggerValues?.[scope] ??
                    (custom_value && !Array.isArray(custom_value)
                        ? custom_value
                        : undefined)
                );

        const resolved = resolvePath(source, key);

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