import { getTableName, SQL } from "drizzle-orm";

import {
    BuildWhereOptions,
    Database,
    RolePermissions,
    Structure,
    StructuredQuery,
    Table,
    TableStructure,
    Transaction,
    TriggerStructure,
    WhereCondition,
} from "../types.js";

import {
    alias_selected_fields,
    extractTableMap,
    resolve_data,
    resolve_fields,
    stripPrefixes,
} from "../rbac.js";

import { VoidQLContext } from "../voidql.js";

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
    protected db: Database | Transaction;
    protected select?: Record<string, any> | Array<Record<string, any>>;
    protected data?: Record<string, any> | Array<Record<string, any>>;
    protected readonly table: Table;
    protected readonly table_name: string;
    protected where?: WhereCondition;
    protected readonly limit: null | number;
    protected readonly returning?: string | string[];
    protected readonly order_by?: string | string[];
    protected readonly group_by?: string | string[];

    /* -------------------------------------------------------------------------- */
    /*                                 PARAMETERS                                 */
    /* -------------------------------------------------------------------------- */
    protected readonly user: any;
    protected readonly role: string;
    protected readonly structure: Structure;
    protected readonly options: BuildWhereOptions;
    protected readonly query: StructuredQuery;
    protected readonly type : string;
    protected readonly table_structure: TableStructure;
    protected readonly role_permissions: RolePermissions;
    protected readonly table_map: Record<string, any>;

    /* -------------------------------------------------------------------------- */
    /*                                  TRIGGERS                                  */
    /* -------------------------------------------------------------------------- */
    protected readonly before_triggers: TriggerStructure[] | null;
    protected readonly after_triggers: TriggerStructure[] | null;
    protected readonly before_values?: any | any[];
    protected readonly after_values?: any | any[];
    protected readonly result_values?: any | any[];

    /* -------------------------------------------------------------------------- */
    /*                                  COMPILED                                  */
    /* -------------------------------------------------------------------------- */
    protected compiled_query?: any;
    protected compiled_before?: any;

    constructor(context: CompilerContext) {
        context.db.transaction(async (tx: Transaction) => {
            this.db = tx;
        })
        this.user = context.user;
        this.role = context.role;
        this.limit = null
        this.structure = context.structure;
        this.options = context.options ?? {};
        this.query = context.query;
        this.before_values = context.before_values;
        this.after_values = context.after_values;
        this.result_values = context.result_values;
        this.returning = this.query.returning;
        this.order_by = this.query.order_by;
        this.group_by = this.query.group_by;

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

        if (this.is_allowed_empty(allowed)) throw new Error("Not allowed");
        
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
        
        this.before_triggers = before_triggers
        this.after_triggers = after_triggers

        switch (this.type.toUpperCase()) {
            case 'GET': {
                this.get()
                break;
            }
            case 'PUT': {
                if (this.after_triggers && this.after_triggers.length != 0) {
                    this.get({
                        select: undefined,
                        key: "compiled_before"
                    })
                }
                this.update()
                break;
            }
            case 'POST': {
                this.insert()
                break;
            }
            case 'DELETE': {
                if (this.after_triggers && this.after_triggers.length != 0) {
                    this.get({
                        select: undefined,
                        key: "compiled_before"
                    })
                }
                this.delete()
                break;
            }
            default: {
                throw new Error("Invalid operation");
            }
        }

        // let result = {
        //     execute: async () => {
        //         let before: any = null
        //         let after: any = null

        //         /* -------------------------------------------------------------------------- */
        //         /*                               QUERY EXECUTION                              */
        //         /* -------------------------------------------------------------------------- */

        //         let result = await this.db.transaction(async (tx: Transaction) => {

        //             /* -------------------------------------------------------------------------- */
        //             /*                               BEFORE TRIGGERS                              */
        //             /* -------------------------------------------------------------------------- */

        //             if (before_triggers && !this.options?.disable_triggers) this.data = await run_triggers(tx, this.options, this.query, this.user, this.role, this.structure, this.table_map, this.table_structure, this.data, before_triggers, false)


        //             /* -------------------------------------------------------------------------- */
        //             /*                           RUN QUERY BASED ON TYPE                          */
        //             /* -------------------------------------------------------------------------- */

        //             let result

        //             switch (this.type.toUpperCase()) {
        //                 case 'GET': {
        //                     result = await get_method(tx, this.query, this.user, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, this.select, this.where, this.table_name, this.limit)
        //                     break;
        //                 }
        //                 case 'PUT': {
        //                     if (has_after_triggers) before = await get_method(tx, this.query, this.user, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, undefined, this.where, this.table_name, this.limit)
        //                     const res = await put_method(tx, this.query, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, this.data, this.where, this.table_name, this.limit, has_after_triggers)
        //                     result = res.result;
        //                     after = res.after;
        //                     break;
        //                 }
        //                 case 'POST': {
        //                     const res = await post_method(tx, this.query, this.structure, this.role, this.table_structure, this.table_map, this.data, this.table_name, has_after_triggers)
        //                     result = res.result;
        //                     after = res.after;
        //                     break;
        //                 }
        //                 case 'DELETE': {
        //                     if (has_after_triggers) before = await get_method(tx, this.query, this.user, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, undefined, this.where, this.table_name, this.limit)
        //                     result = await delete_method(tx, this.query, this.structure, this.role_permissions, this.role, this.table_structure, this.table_map, this.where, this.table_name, this.limit)
        //                     break;
        //                 }
        //                 default: {
        //                     throw new Error("Invalid operation");
        //                 }
        //             }

        //             /* -------------------------------------------------------------------------- */
        //             /*                               AFTER TRIGGERS                               */
        //             /* -------------------------------------------------------------------------- */
        //             if (after_triggers && has_after_triggers) await run_triggers(tx, this.options, this.query, this.user, this.role, this.structure, this.table_map, this.table_structure, this.data, after_triggers, true, before, after, result)

        //             return result
        //         })

        //         return result
        //     }
        // }

        // return result
    }

    public async execute():Promise<any[] | undefined> {
        if(this.compiled_query && "execute" in this.compiled_query && typeof this.compiled_query.execute == "function") {
            const result = await this.compiled_query.execute()
        }
        else throw new Error("Query execution failed")
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
                if (!this.data) {
                    throw new Error("Data is necessary on PUT/POST requests");
                }

                this.data = this.validate_fields(
                    stripPrefixes(
                        resolve_data(
                            this.structure,
                            this.user,
                            this.query,
                            this.data,
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
}