import { JustRequest } from '../../models/Request';
import { Variable } from '../../models/Variable';
import {
  RequestResolutionResult,
  VariableDiagnostic,
  VariableResolutionResult,
} from '../../models/VariableResolution';

export interface ResolutionContext {
  requestVars: Variable[];
  collectionVars: Variable[];
  setsVars?: Variable[];
  globalVars: Variable[];
}

export interface VariableEngineOptions {
  maximumDepth: number;
  maximumInputLength: number;
  maximumOutputLength: number;
  maximumDiagnostics: number;
}

export const VARIABLE_ENGINE_DEFAULTS: VariableEngineOptions = {
  maximumDepth: 20,
  maximumInputLength: 10 * 1024 * 1024,
  maximumOutputLength: 10 * 1024 * 1024,
  maximumDiagnostics: 200,
};

interface VariableSymbol {
  key: string;
  value: string;
  duplicate: boolean;
}

interface SymbolTable {
  enabled: Map<string, VariableSymbol>;
  disabled: Set<string>;
}

interface ResolutionState {
  diagnostics: VariableDiagnostic[];
  diagnosticKeys: Set<string>;
}

const VARIABLE_NAME = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/;

function cloneRequest(request: JustRequest): JustRequest {
  return JSON.parse(JSON.stringify(request)) as JustRequest;
}

export class VariableEngine {
  private readonly options: VariableEngineOptions;

  constructor(options: Partial<VariableEngineOptions> = {}) {
    this.options = { ...VARIABLE_ENGINE_DEFAULTS, ...options };
    if (this.options.maximumDepth < 1
      || this.options.maximumInputLength < 1
      || this.options.maximumOutputLength < 1
      || this.options.maximumDiagnostics < 1) {
      throw new Error('VariableEngine limits must be positive.');
    }
  }

  resolve(input: string, context: ResolutionContext, extraVars?: Record<string, string>): string {
    return this.resolveDetailed(input, context, extraVars).value;
  }

  resolveDetailed(
    input: string,
    context: ResolutionContext,
    extraVars?: Record<string, string>,
    location = 'value'
  ): VariableResolutionResult {
    const state = this.createState();
    const table = this.buildSymbolTable(context, extraVars);
    const value = this.resolveTemplate(input, table, [], 0, location, state);
    return { value, diagnostics: state.diagnostics };
  }

  resolveRequest(
    request: JustRequest,
    context: ResolutionContext,
    extraVars?: Record<string, string>
  ): RequestResolutionResult {
    const resolved = cloneRequest(request);
    const state = this.createState();
    const table = this.buildSymbolTable(context, extraVars);
    const apply = (input: string, location: string): string =>
      this.resolveTemplate(input, table, [], 0, location, state);

    resolved.url = apply(resolved.url, 'url');
    resolved.headers.forEach((header, index) => {
      if (!header.enabled) { return; }
      header.key = apply(header.key, `headers[${index}].key`);
      header.value = apply(header.value, `headers[${index}].value`);
    });
    resolved.queryParams.forEach((param, index) => {
      if (!param.enabled) { return; }
      param.key = apply(param.key, `queryParams[${index}].key`);
      param.value = apply(param.value, `queryParams[${index}].value`);
    });
    resolved.pathParams.forEach((param, index) => {
      param.name = apply(param.name, `pathParams[${index}].name`);
      param.value = apply(param.value, `pathParams[${index}].value`);
    });
    if (resolved.body.type !== 'none') {
      resolved.body.content = apply(resolved.body.content, 'body.content');
      resolved.body.formData?.forEach((field, index) => {
        if (!field.enabled) { return; }
        field.key = apply(field.key, `body.formData[${index}].key`);
        field.value = apply(field.value, `body.formData[${index}].value`);
      });
    }
    if (resolved.auth.type === 'apiKey') {
      resolved.auth.name = apply(resolved.auth.name, 'auth.name');
    }

    return {
      ok: state.diagnostics.length === 0,
      request: resolved,
      diagnostics: state.diagnostics,
    };
  }

  findUnresolved(input: string, context?: ResolutionContext): string[] {
    if (!context) {
      return this.extractVariables(input);
    }
    const result = this.resolveDetailed(input, context);
    return Array.from(new Set(result.diagnostics
      .map(diagnostic => diagnostic.variable)
      .filter((variable): variable is string => Boolean(variable))));
  }

  extractVariables(input: string): string[] {
    const variables: string[] = [];
    let cursor = 0;
    while (cursor < input.length) {
      const regular = input.indexOf('{{', cursor);
      if (regular < 0) { break; }
      if (regular > 0 && input[regular - 1] === '\\') {
        cursor = regular + 2;
        continue;
      }
      const end = input.indexOf('}}', regular + 2);
      if (end < 0) { break; }
      variables.push(input.slice(regular + 2, end).trim());
      cursor = end + 2;
    }
    return variables;
  }

  getCompletions(context: ResolutionContext): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const scopes = [
      context.requestVars,
      context.collectionVars,
      context.setsVars || [],
      context.globalVars,
    ];
    for (const variables of scopes) {
      const keys = variables
        .filter(variable => variable.enabled && VARIABLE_NAME.test(variable.key))
        .map(variable => variable.key)
        .sort((left, right) => left.localeCompare(right));
      for (const key of keys) {
        if (!seen.has(key)) {
          seen.add(key);
          result.push(key);
        }
      }
    }
    return result;
  }

  private createState(): ResolutionState {
    return { diagnostics: [], diagnosticKeys: new Set() };
  }

  private buildSymbolTable(
    context: ResolutionContext,
    extraVars?: Record<string, string>
  ): SymbolTable {
    const enabled = new Map<string, VariableSymbol>();
    const disabled = new Set<string>();
    const scopes = [
      context.globalVars,
      context.setsVars || [],
      context.collectionVars,
      context.requestVars,
    ];

    for (const variables of scopes) {
      const groups = new Map<string, Variable[]>();
      for (const variable of variables) {
        if (!VARIABLE_NAME.test(variable.key)) { continue; }
        if (!variable.enabled) {
          disabled.add(variable.key);
          continue;
        }
        const group = groups.get(variable.key) || [];
        group.push(variable);
        groups.set(variable.key, group);
      }
      for (const [key, group] of Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right))) {
        const ordered = [...group].sort((left, right) => left.id.localeCompare(right.id));
        enabled.set(key, {
          key,
          value: ordered[0].value,
          duplicate: ordered.length > 1,
        });
      }
    }

    for (const [key, value] of Object.entries(extraVars || {}).sort(([left], [right]) => left.localeCompare(right))) {
      if (VARIABLE_NAME.test(key)) {
        enabled.set(key, { key, value, duplicate: false });
      }
    }
    return { enabled, disabled };
  }

  private resolveTemplate(
    input: string,
    table: SymbolTable,
    stack: string[],
    depth: number,
    location: string,
    state: ResolutionState
  ): string {
    if (input.length > this.options.maximumInputLength) {
      this.addDiagnostic(state, { code: 'INPUT_LIMIT_EXCEEDED', location });
      return input.slice(0, this.options.maximumOutputLength);
    }
    if (!input.includes('{{')) {
      if (input.length > this.options.maximumOutputLength) {
        this.addDiagnostic(state, { code: 'OUTPUT_LIMIT_EXCEEDED', location });
        return input.slice(0, this.options.maximumOutputLength);
      }
      return input;
    }

    let output = '';
    let cursor = 0;
    while (cursor < input.length) {
      const escapedStart = input.indexOf('\\{{', cursor);
      const regularStart = input.indexOf('{{', cursor);
      if (regularStart < 0) {
        output += input.slice(cursor);
        break;
      }

      const escaped = escapedStart >= 0 && escapedStart + 1 === regularStart;
      const start = escaped ? escapedStart : regularStart;
      output += input.slice(cursor, start);
      const contentStart = regularStart + 2;
      const end = input.indexOf('}}', contentStart);
      if (end < 0) {
        if (escaped) {
          output += input.slice(regularStart);
        } else {
          this.addDiagnostic(state, { code: 'INVALID_TEMPLATE', location });
          output += input.slice(start);
        }
        break;
      }

      const rawName = input.slice(contentStart, end);
      if (escaped) {
        output += `{{${rawName}}}`;
      } else {
        output += this.resolvePlaceholder(rawName, table, stack, depth, location, state);
      }
      cursor = end + 2;

      if (output.length > this.options.maximumOutputLength) {
        this.addDiagnostic(state, { code: 'OUTPUT_LIMIT_EXCEEDED', location });
        return output.slice(0, this.options.maximumOutputLength);
      }
    }
    return output;
  }

  private resolvePlaceholder(
    rawName: string,
    table: SymbolTable,
    stack: string[],
    depth: number,
    location: string,
    state: ResolutionState
  ): string {
    const name = rawName.trim();
    const original = `{{${rawName}}}`;
    if (!VARIABLE_NAME.test(name)) {
      this.addDiagnostic(state, {
        code: 'INVALID_VARIABLE',
        location,
        ...(name ? { variable: name.slice(0, 128) } : {}),
      });
      return original;
    }

    const symbol = table.enabled.get(name);
    if (!symbol) {
      this.addDiagnostic(state, {
        code: table.disabled.has(name) ? 'DISABLED_VARIABLE' : 'MISSING_VARIABLE',
        variable: name,
        location,
      });
      return original;
    }
    if (symbol.duplicate) {
      this.addDiagnostic(state, { code: 'DUPLICATE_VARIABLE', variable: name, location });
    }
    if (stack.includes(name)) {
      const cycleStart = stack.indexOf(name);
      this.addDiagnostic(state, {
        code: 'CYCLIC_VARIABLE',
        variable: name,
        location,
        path: [...stack.slice(cycleStart), name],
      });
      return original;
    }
    if (depth >= this.options.maximumDepth) {
      this.addDiagnostic(state, {
        code: 'MAX_DEPTH_EXCEEDED',
        variable: name,
        location,
        path: [...stack, name],
      });
      return original;
    }
    return this.resolveTemplate(symbol.value, table, [...stack, name], depth + 1, location, state);
  }

  private addDiagnostic(state: ResolutionState, diagnostic: VariableDiagnostic): void {
    if (state.diagnostics.length >= this.options.maximumDiagnostics) { return; }
    const key = JSON.stringify(diagnostic);
    if (!state.diagnosticKeys.has(key)) {
      state.diagnosticKeys.add(key);
      state.diagnostics.push(diagnostic);
    }
  }
}
