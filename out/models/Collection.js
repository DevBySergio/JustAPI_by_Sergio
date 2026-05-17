"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultCollection = createDefaultCollection;
function createDefaultCollection(name) {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        name,
        items: [],
        variables: [],
        created: now,
        updated: now,
    };
}
//# sourceMappingURL=Collection.js.map