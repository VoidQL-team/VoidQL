import type {
    Database,
    Transaction,
    Request,
    StructuredQuery,
    QueryPhase,
    Structure,
    BuildWhereOptions,
    CompileResult
} from "./types.ts";

export type VoidQLContext = {
    db: Database | Transaction;
    user: any;
    role: string;
    structure: Structure;
    options?: BuildWhereOptions;
};

export class VoidQL {
    protected readonly db: Database | Transaction;
    protected readonly user: any;
    protected readonly role: string;
    protected readonly structure: Structure;
    protected readonly options: BuildWhereOptions;

    constructor(context: VoidQLContext) {
        this.db = context.db;
        this.user = context.user;
        this.role = context.role;
        this.structure = context.structure;
        this.options = context.options ?? {};
    }

    async compile(request: Request): Promise<CompileResult<any>> {
        if ("phases" in request && request.phases) {
            const parts = await Promise.all(
                request.phases.map((phase) =>
                    this.build_batch(phase)
                )
            );
        
            return {
                async execute() {
                    const results = await Promise.all(
                        parts.map((part) => part.execute())
                    );
            
                    return {
                        ok: results.every((r: any) => r.ok),
                        data: results
                    };
                }
            };
        }
    
        const single = await this.build_query(request as StructuredQuery);
    
        return {
            async execute() {
                try {
                    const res = await single.execute();
            
                    return {
                        ok: true,
                        data: res
                    };
                } catch (err) {
                    return {
                        ok: false,
                        error: err
                    };
                }
            }
        };
    }

    protected async build_query(
        query: StructuredQuery,
        db: Database | Transaction = this.db
    ) {
        return {
            execute: async (): Promise<any[]> => {
                return [];
            }
        };
    }

    protected async build_batch(phase: QueryPhase) {
        const mode = phase.mode.toUpperCase();

        if (mode === "QUERY") {
            const plans = await Promise.all(
                phase.queries.map((query) => this.build_query(query))
            );

            return {
                execute: async () => {
                    const results = [];
                    const errors = [];

                    for (const plan of plans) {
                        try {
                            results.push(await plan.execute());
                        } catch (err) {
                            errors.push(err);
                        }
                    }

                    return {
                        ok: errors.length === 0,
                        data: results,
                        error: errors.length ? errors : undefined
                    };
                }
            };
        }

        if (mode === "TRANSACTION") {
            return {
                execute: async () => {
                    try {
                        return {
                            ok: true,
                            data: await this.db.transaction(async (tx: Transaction) => {
                                const plans = await Promise.all(
                                    phase.queries.map((query) =>
                                        this.build_query(query, tx)
                                    )
                                );

                                return Promise.all(
                                    plans.map((plan) => plan.execute())
                                );
                            })
                        };
                    } catch (err) {
                        return {
                            ok: false,
                            error: err
                        };
                    }
                }
            };
        }

        throw new Error(`Unsupported phase mode: ${phase.mode}`);
    }
}
