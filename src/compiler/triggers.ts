import { getColumns, inArray } from "drizzle-orm";
import { Compiler } from "./index.js";
import { Endpoint } from "../types.js";

declare module "./index.js" {
    interface Compiler {
        define_triggers(endpoint: Endpoint):void;
        execute_triggers(type: "before_triggers" | "after_triggers"): Promise<void>;
    }
}

Compiler.prototype.define_triggers = function(endpoint: Endpoint) {
    if(!this.options.disable_triggers) {
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
        
        if(before_triggers) this.before_triggers = before_triggers
        if(after_triggers) this.after_triggers = after_triggers
    }
}

Compiler.prototype.execute_triggers = async function(type: "before_triggers" | "after_triggers") {
    const triggers = this.compiled?.[type];

    if (!triggers) return;

    for (const trigger of triggers) {
        await trigger.execute();
    }
}