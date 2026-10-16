export const postmanCollection = (item: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  info: { name: 'Migration fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item, ...extra,
});
export const postmanRequest = (name = 'Echo', request: Record<string, unknown> = {}) => ({ name, request: { method: 'GET', url: 'https://local.test/echo', ...request } });
export const postmanEnvironment = (values: unknown[] = []) => ({ name: 'Local migration', _postman_variable_scope: 'environment', values });
