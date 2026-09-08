import { getTableName } from "drizzle-orm";

import {
    BuildWhereOptions,
    CompileResult,
    Database,
    QueryPhase,
    Request,
    Structure,
    StructuredQuery,
    TableStructure,
    Transaction,
    WhereCondition,
} from "./types.js";

import {
    alias_selected_fields,
    extractTableMap,
    resolve_data,
    resolve_fields,
    stripPrefixes,
    validate_where_fields,
} from "./rbac.js";

import {
    buildAclWhere,
    buildWhere,
    delete_method,
    get_method,
    if_condition,
    is_allowed_empty,
    post_method,
    put_method,
    run_triggers,
} from "./drizzle.js";
import { VoidQLContext } from "./voidql.js";

export type CompilerContext = VoidQLContext & {
  query: StructuredQuery;
  before_values?: any | any[];
  after_values?: any | any[];
  result_values?: any | any[];
};

export class Compiler {
    protected readonly db: Database | Transaction;
    protected readonly user: any;
    protected readonly role: string;
    protected readonly structure: Structure;
    protected readonly options: BuildWhereOptions;
    protected readonly query: StructuredQuery;
    protected readonly query_type : string;
    protected readonly table_name: string;
    protected readonly table_structure: TableStructure;
    private readonly before_values?: any | any[];
    private readonly after_values?: any | any[];
    private readonly result_values?: any | any[];

    constructor(context: CompilerContext) {
        this.db = context.db;
        this.user = context.user;
        this.role = context.role;
        this.structure = context.structure;
        this.options = context.options ?? {};
        this.query = context.query;
        this.before_values = context.before_values;
        this.after_values = context.after_values;
        this.result_values = context.result_values;

        /* -------------------------------------------------------------------------- */
        /*                              TABLE RETRIEVING                              */
        /* -------------------------------------------------------------------------- */
        this.table_structure = this.structure[this.query.table];
        if (!this.table_structure) throw new Error(`Table ${this.query.table} not found`);

        this.query_type = this.query.type.toUpperCase()

        /* -------------------------------------------------------------------------- */
        /*                             ENDPOINT RETRIEVING                            */
        /* -------------------------------------------------------------------------- */
        const endpoint = this.table_structure.endpoints.find((e: any) => e.type.toUpperCase() === this.query_type);
        if (!endpoint) throw new Error(`${this.query_type} not allowed on ${this.query.table}`);

        if (!endpoint[this.role]) {
            throw new Error(`Role '${this.role}' not allowed to perform ${this.query_type} on ${this.query.table}`);
        }

        /* -------------------------------------------------------------------------- */
        /*                                    ROLES                                   */
        /* -------------------------------------------------------------------------- */
        const rolePermissions = endpoint[this.role];
        if (typeof rolePermissions === "string" || Array.isArray(rolePermissions)) {
            throw new Error(`Invalid role permissions format for role '${this.role}'`);
        }

        const allowed =
            'allowed' in rolePermissions
                ? rolePermissions.allowed ?? []
                : 'allow' in rolePermissions
                    ? rolePermissions.allow ?? []
                    : [];

        const disallowed =
            'disallowed' in rolePermissions
                ? rolePermissions.disallowed ?? []
                : 'deny' in rolePermissions
                    ? rolePermissions.deny ?? []
                    : [];

        if (is_allowed_empty(allowed)) throw new Error("Not allowed");

        /* -------------------------------------------------------------------------- */
        /*               QUERY VALIDATION CHECK BEFORE RUNNING THE QUERY              */
        /* -------------------------------------------------------------------------- */

        const tableMap = extractTableMap(this.structure);

        const default_table = this.table_structure.table
        this.table_name = getTableName(default_table)

        const aclWhere = buildAclWhere(allowed, disallowed);

        let combinedWhere: WhereCondition | undefined;
        let query_where = this.query.where ? validate_where_fields(this.query.where, tableMap, this.table_name, this.structure, this.role, this.query_type) : this.query.where
        if (query_where && aclWhere) {
            combinedWhere = {
                and: [aclWhere, query_where]
            };
        } else if (query_where) {
            combinedWhere = query_where;
        } else if (aclWhere) {
            combinedWhere = aclWhere
        }

        if (combinedWhere && (typeof allowed != 'string' && !Array.isArray(allowed) || typeof disallowed != 'string' && !Array.isArray(disallowed))) {
            const has_been_accepted = await if_condition(this.db, combinedWhere, tableMap, this.user, this.role, this.structure, this.query, default_table)
            if (!has_been_accepted) throw new Error("Not allowed or Empty")
        }

        let limit = null
        if (this.query.limit) limit = this.query.limit

        if (rolePermissions.limit && (limit === null || limit > rolePermissions.limit)) {
            limit = rolePermissions.limit
        }

        /* -------------------------------------------------------------------------- */
        /*                           ALLOWED FIELDS RESOLVER                          */
        /* -------------------------------------------------------------------------- */

        const built_where = combinedWhere ? await buildWhere(this.db, combinedWhere!, tableMap, this.user, this.role, this.structure, this.query, default_table, this.table_name, undefined, this.before_values, this.after_values, this.result_values) : false

        let user_select_data_fields: Record<string, any> = {};

        if (this.query_type == "GET") {
            if ("select" in this.query && this.query.select) {
                user_select_data_fields = resolve_fields(this.structure, this.query.select, this.query_type, this.role, this.query.table, tableMap);
                user_select_data_fields = alias_selected_fields(user_select_data_fields);
            } else throw Error("Select is necessary on GET request")
        }
        if (this.query_type == "DELETE") {
            user_select_data_fields = resolve_fields(this.structure, "*", this.query_type, this.role, this.query.table, tableMap);
            user_select_data_fields = alias_selected_fields(user_select_data_fields);
        }
        if (this.query_type == "PUT" || this.query_type == "POST") {
            if ("data" in this.query && this.query.data) {
                user_select_data_fields = resolve_data(this.structure, this.user, this.query, this.query.data, this.query_type, this.role, this.query.table, tableMap, this.before_values, this.after_values, this.result_values);
                user_select_data_fields = stripPrefixes(user_select_data_fields);
            } else throw Error("Data is necessary on PUT/POST requests")
        }

        let result: any

        console.log(user_select_data_fields)

        let selected_data_fields: Record<string, any> | Array<Record<string, any>> =
            Array.isArray(user_select_data_fields)
                ? [...user_select_data_fields]
                : { ...user_select_data_fields };

        if (!Object.keys(selected_data_fields).length) {
            throw new Error("No allowed fields");
        }

        /* -------------------------------------------------------------------------- */
        /*                             TRIGGERS FILTERING                             */
        /* -------------------------------------------------------------------------- */

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

        const has_after_triggers = !this.options?.disable_triggers ? (after_triggers != null ? after_triggers.length != 0 : false) : false

        result = {
            execute: async () => {
                let before: any = null
                let after: any = null

                /* -------------------------------------------------------------------------- */
                /*                               QUERY EXECUTION                              */
                /* -------------------------------------------------------------------------- */

                let result = await this.db.transaction(async (tx: Transaction) => {

                    /* -------------------------------------------------------------------------- */
                    /*                               BEFORE TRIGGERS                              */
                    /* -------------------------------------------------------------------------- */

                    if (before_triggers && !this.options?.disable_triggers) selected_data_fields = await run_triggers(tx, this.options, this.query, this.user, this.role, this.structure, tableMap, this.table_structure, user_select_data_fields, before_triggers, false)


                    /* -------------------------------------------------------------------------- */
                    /*                           RUN QUERY BASED ON TYPE                          */
                    /* -------------------------------------------------------------------------- */

                    let result

                    switch (this.query_type.toUpperCase()) {
                        case 'GET': {
                            result = await get_method(tx, this.query, this.user, this.structure, rolePermissions, this.role, this.table_structure, tableMap, selected_data_fields, built_where, this.table_name, limit)
                            break;
                        }
                        case 'PUT': {
                            if (has_after_triggers) before = await get_method(tx, this.query, this.user, this.structure, rolePermissions, this.role, this.table_structure, tableMap, undefined, built_where, this.table_name, limit)
                            const res = await put_method(tx, this.query, this.structure, rolePermissions, this.role, this.table_structure, tableMap, selected_data_fields, built_where, this.table_name, limit, has_after_triggers)
                            result = res.result;
                            after = res.after;
                            break;
                        }
                        case 'POST': {
                            const res = await post_method(tx, this.query, this.structure, this.role, this.table_structure, tableMap, selected_data_fields, this.table_name, has_after_triggers)
                            result = res.result;
                            after = res.after;
                            break;
                        }
                        case 'DELETE': {
                            if (has_after_triggers) before = await get_method(tx, this.query, this.user, this.structure, rolePermissions, this.role, this.table_structure, tableMap, undefined, built_where, this.table_name, limit)
                            result = await delete_method(tx, this.query, this.structure, rolePermissions, this.role, this.table_structure, tableMap, built_where, this.table_name, limit)
                            break;
                        }
                        default: {
                            throw new Error("Invalid operation");
                        }
                    }

                    /* -------------------------------------------------------------------------- */
                    /*                               AFTER TRIGGERS                               */
                    /* -------------------------------------------------------------------------- */
                    if (after_triggers && has_after_triggers) await run_triggers(tx, this.options, this.query, this.user, this.role, this.structure, tableMap, this.table_structure, user_select_data_fields, after_triggers, true, before, after, result)

                    return result
                })

                return result
            }
        }

        return result
    }
}