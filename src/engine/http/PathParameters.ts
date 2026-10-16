import type { PathParam } from '../../models/KeyValuePair';

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;

export class PathParameterError extends Error {
  constructor() { super('Review the path parameter names and values.'); this.name = 'PathParameterError'; }
}

/** Only entire /:name path segments are placeholders. Hosts, ports, queries and fragments are literal. */
export function substitutePathParameters(url: URL, parameters: readonly PathParam[]): void {
  const values = new Map<string, string>();
  for (const parameter of parameters) {
    if (!parameter.name && !parameter.value) { continue; }
    if (!PARAMETER_NAME.test(parameter.name) || values.has(parameter.name)) { throw new PathParameterError(); }
    values.set(parameter.name, parameter.value);
  }
  const path = url.pathname.split('/').map(segment => {
    if (!segment.startsWith(':') || !PARAMETER_NAME.test(segment.slice(1))) { return segment; }
    const value = values.get(segment.slice(1));
    // URL parsers normalize dot segments, even when percent encoded. Reject rather than change the route.
    if (value === undefined || value === '' || value === '.' || value === '..') { throw new PathParameterError(); }
    try { return encodeURIComponent(value); }
    catch { throw new PathParameterError(); }
  }).join('/');
  url.pathname = path;
}
