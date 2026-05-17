"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultRequest = createDefaultRequest;
function createDefaultRequest() {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        name: 'New Request',
        method: 'GET',
        url: '',
        headers: [],
        queryParams: [],
        pathParams: [],
        body: { type: 'none', content: '' },
        settings: {
            timeout: 30000,
            followRedirects: true,
            verifySSL: true,
        },
        variables: [],
        created: now,
        updated: now,
    };
}
//# sourceMappingURL=Request.js.map