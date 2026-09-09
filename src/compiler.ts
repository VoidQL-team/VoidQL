import { getTableName } from "drizzle-orm";

import {
    BuildWhereOptions,
    CompileResult,
    Database,
    FieldPermission,
    QueryPhase,
    Request,
    RolePermissions,
    Structure,
    StructuredQuery,
    Table,
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
    /* -------------------------------------------------------------------------- */
    /*                                  DATABASE                                  */
    /* -------------------------------------------------------------------------- */
    protected readonly db: Database | Transaction;
    protected select?: Record<string, any> | Array<Record<string, any>>;
    protected data?: Record<string, any> | Array<Record<string, any>>;
    protected readonly table: Table;
    protected readonly table_name: string;
    protected where?: WhereCondition;
    protected readonly limit: null | number;
    protected readonly user: any;
    protected readonly role: string;
    protected readonly structure: Structure;
    protected readonly options: BuildWhereOptions;
    protected readonly query: StructuredQuery;
    protected readonly type : string;
    protected readonly table_structure: TableStructure;
    protected readonly role_permissions: RolePermissions;
    protected readonly table_map: Record<string, any>;
    protected readonly before_values?: any | any[];
    protected readonly after_values?: any | any[];
    protected readonly result_values?: any | any[];

    constructor(context: CompilerContext) {
        this.db = context.db;
        this.user = context.user;
        this.role = context.role;
        this.limit = null
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

        this.type = this.query.type.toUpperCase()

        /* -------------------------------------------------------------------------- */
        /*                             ENDPOINT RETRIEVING                            */
        /* -------------------------------------------------------------------------- */
        const endpoint = this.table_structure.endpoints.find((e: any) => e.type.toUpperCase() === this.type);
        if (!endpoint) throw new Error(`${this.type} not allowed on ${this.query.table}`);

        if (!endpoint[this.role]) {
            throw new Error(`Role '${this.role}' not allowed to perform ${this.type} on ${this.query.table}`);
        }

        /* -------------------------------------------------------------------------- */
        /*                                    ROLES                                   */
        /* -------------------------------------------------------------------------- */
        this.role_permissions = endpoint[this.role];
        if (typeof this.role_permissions === "string" || Array.isArray(this.role_permissions)) {
            throw new Error(`Invalid role permissions format for role '${this.role}'`);
        }

        const allowed =
            'allowed' in this.role_permissions
                ? this.role_permissions.allowed ?? []
                : 'allow' in this.role_permissions
                    ? this.role_permissions.allow ?? []
                    : [];

        const disallowed =
            'disallowed' in this.role_permissions
                ? this.role_permissions.disallowed ?? []
                : 'deny' in this.role_permissions
                    ? this.role_permissions.deny ?? []
                    : [];

        if (is_allowed_empty(allowed)) throw new Error("Not allowed");
        
        if (this.query.limit) this.limit = this.query.limit

        if (this.role_permissions.limit && (this.limit === null || this.limit > this.role_permissions.limit)) {
            this.limit = this.role_permissions.limit
        }

        /* -------------------------------------------------------------------------- */
        /*               QUERY VALIDATION CHECK BEFORE RUNNING THE QUERY              */
        /* -------------------------------------------------------------------------- */

        this.table = this.table_structure.table
        this.table_map = extractTableMap(this.structure);
        this.table_name = getTableName(this.table)

        this.define_where(allowed, disallowed)

        /* -------------------------------------------------------------------------- */
        /*                           ALLOWED FIELDS RESOLVER                          */
        /* -------------------------------------------------------------------------- */

        this.define_select_data()

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

        let result = {
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

                    if (before_triggers && !this.options?.disable_triggers) this.data = await run_triggers(tx, this.options, this.query, this.user, this.role, this.structure, this.table_map, this.table_structure, this.data, before_triggers, false)


                    /* -------------------------------------------------------------------------- */
                    /*                           RUN QUERY BASED ON TYPE                          */
                    /* -------------------------------------------------------------------------- */

                    let result

                    switch (this.type.toUpperCase()) {
                        case 'GET': {
                            result = await get_method(tx, this.query, this.user, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, this.select, this.where, this.table_name, this.limit)
                            break;
                        }
                        case 'PUT': {
                            if (has_after_triggers) before = await get_method(tx, this.query, this.user, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, undefined, this.where, this.table_name, this.limit)
                            const res = await put_method(tx, this.query, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, this.data, this.where, this.table_name, this.limit, has_after_triggers)
                            result = res.result;
                            after = res.after;
                            break;
                        }
                        case 'POST': {
                            const res = await post_method(tx, this.query, this.structure, this.role, this.table_structure, this.table_map, this.data, this.table_name, has_after_triggers)
                            result = res.result;
                            after = res.after;
                            break;
                        }
                        case 'DELETE': {
                            if (has_after_triggers) before = await get_method(tx, this.query, this.user, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, undefined, this.where, this.table_name, this.limit)
                            result = await delete_method(tx, this.query, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, this.where, this.table_name, this.limit)
                            break;
                        }
                        default: {
                            throw new Error("Invalid operation");
                        }
                    }

                    /* -------------------------------------------------------------------------- */
                    /*                               AFTER TRIGGERS                               */
                    /* -------------------------------------------------------------------------- */
                    if (after_triggers && has_after_triggers) await run_triggers(tx, this.options, this.query, this.user, this.role, this.structure, this.table_map, this.table_structure, this.data, after_triggers, true, before, after, result)

                    return result
                })

                return result
            }
        }

        return result
    }

    private validate_fields(
        value: Record<string, any> | Array<Record<string, any>>
    ) {
        const result = Array.isArray(value)
            ? [...value]
            : { ...value };

        if (!Object.keys(result).length) {
            throw new Error("No allowed fields");
        }

        return result;
    }

    private define_select_data() {
        switch (this.type) {
            case "GET": {
                if (!this.query.select) {
                    throw new Error("Select is necessary on GET request");
                }

                this.select = this.validate_fields(
                    alias_selected_fields(
                        resolve_fields(
                            this.structure,
                            this.query.select,
                            this.type,
                            this.role,
                            this.query.table,
                            this.table_map
                        )
                    )
                );

                break;
            }

            case "DELETE": {
                this.select = this.validate_fields(
                    alias_selected_fields(
                        resolve_fields(
                            this.structure,
                            "*",
                            this.type,
                            this.role,
                            this.query.table,
                            this.table_map
                        )
                    )
                );

                break;
            }

            case "PUT":
            case "POST": {
                if (!this.query.data) {
                    throw new Error("Data is necessary on PUT/POST requests");
                }

                this.data = this.validate_fields(
                    stripPrefixes(
                        resolve_data(
                            this.structure,
                            this.user,
                            this.query,
                            this.query.data,
                            this.type,
                            this.role,
                            this.query.table,
                            this.table_map,
                            this.before_values,
                            this.after_values,
                            this.result_values
                        )
                    )
                );

                break;
            }
        }
    }

    private define_where(allowed: FieldPermission, disallowed: FieldPermission) {
        const aclWhere = buildAclWhere(allowed, disallowed);

        let query_where = this.query.where ? validate_where_fields(this.query.where, this.table_map, this.table_name, this.structure, this.role, this.type) : this.query.where
        if (query_where && aclWhere) {
            this.where = {
                and: [aclWhere, query_where]
            };
        } else if (query_where) {
            this.where = query_where;
        } else if (aclWhere) {
            this.where = aclWhere
        }

        if (this.where && (typeof allowed != 'string' && !Array.isArray(allowed) || typeof disallowed != 'string' && !Array.isArray(disallowed))) {
            const has_been_accepted = await if_condition(this.db, this.where, this.table_map, this.user, this.role, this.structure, this.query, this.table)
            if (!has_been_accepted) throw new Error("Not allowed or Empty")
        }

        this.where = this.where ? await buildWhere(this.db, this.where!, this.table_map, this.user, this.role, this.structure, this.query, this.table, this.table_name, undefined, this.before_values, this.after_values, this.result_values) : false
    }
}