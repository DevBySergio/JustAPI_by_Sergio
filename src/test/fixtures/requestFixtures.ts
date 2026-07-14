import { JustRequest, createDefaultRequest } from '../../models/Request';

export function createRequestFixture(overrides: Partial<JustRequest> = {}): JustRequest {
  const request = createDefaultRequest();
  return {
    ...request,
    ...overrides,
    body: overrides.body ?? request.body,
    settings: overrides.settings ?? request.settings,
    headers: overrides.headers ?? request.headers,
    queryParams: overrides.queryParams ?? request.queryParams,
    pathParams: overrides.pathParams ?? request.pathParams,
    variables: overrides.variables ?? request.variables,
  };
}
