import { getTableName } from "drizzle-orm";

import {
    BuildWhereOptions,
    Compiled,
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
    protected before_triggers?: TriggerStructure[];
    protected after_triggers?: TriggerStructure[];
    protected readonly before_values?: any | any[];
    protected readonly after_values?: any | any[];
    protected readonly result_values?: any | any[];

    /* -------------------------------------------------------------------------- */
    /*                                  COMPILED                                  */
    /* -------------------------------------------------------------------------- */
    protected compiled?: Compiled;

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

        this.define_triggers(endpoint)

        switch (this.type.toUpperCase()) {
            case 'GET': {
                this.get()
                break;
            }
            case 'PUT': {
                if (this.after_triggers && this.after_triggers.length != 0) {
                    this.get({
                        select: undefined,
                        key: "before"
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
                        key: "before"
                    })
                }
                this.delete()
                break;
            }
            default: {
                throw new Error("Invalid operation");
            }
        }
    }

    public async execute():Promise<any[] | undefined> {
        if(this.compiled && this.compiled.query && "execute" in this.compiled.query && typeof this.compiled.query.execute == "function") {
            this.execute_triggers("before_triggers")
            let before:any = this.compiled.before ? this.compiled.before.execute() : null;
            const query_result = await this.compiled.query.execute()
            const { result, after } = await this.handle_after(query_result)
            return result
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