"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultVariableSet = createDefaultVariableSet;
function createDefaultVariableSet(name) {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        name,
        variables: [],
        linkedCollectionIds: [],
        created: now,
        updated: now,
    };
}
//# sourceMappingURL=VariableSet.js.map