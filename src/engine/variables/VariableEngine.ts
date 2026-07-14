import { Variable } from '../../models/Variable';

export interface ResolutionContext {
  requestVars: Variable[];
  collectionVars: Variable[];
  setsVars?: Variable[];
  globalVars: Variable[];
}

export class VariableEngine {
  resolve(input: string, context: ResolutionContext, extraVars?: Record<string, string>): string {
    if (!input || !input.includes('{{')) { return input; }

    let result = input;

    // Resolve user variables with priority: request > collection > sets > global
    const allVars = [
      ...context.globalVars.filter(v => v.enabled),
      ...(context.setsVars || []).filter(v => v.enabled),
      ...context.collectionVars.filter(v => v.enabled),
      ...context.requestVars.filter(v => v.enabled),
    ];

    for (const v of allVars) {
      const pattern = `{{${v.key}}}`;
      while (result.includes(pattern)) {
        result = result.replace(pattern, v.value);
      }
    }

    // Resolve extra vars (e.g., workspaceFolder, currentFile, env)
    if (extraVars) {
      for (const [key, value] of Object.entries(extraVars)) {
        const pattern = `{{${key}}}`;
        while (result.includes(pattern)) {
          result = result.replace(pattern, value);
        }
      }
    }

    return result;
  }

  findUnresolved(input: string, context?: ResolutionContext): string[] {
    if (!input || !input.includes('{{')) { return []; }
    const regex = /\{\{([^}]+)\}\}/g;
    const unresolved: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      const varName = match[1].trim();
      if (varName.startsWith('$')) { continue; }
      if (context) {
        const available = [
          ...context.requestVars.filter(v => v.enabled),
          ...context.collectionVars.filter(v => v.enabled),
          ...(context.setsVars || []).filter(v => v.enabled),
          ...context.globalVars.filter(v => v.enabled),
        ];
        const found = available.some(v => v.key === varName);
        if (!found) { unresolved.push(varName); }
      } else {
        unresolved.push(varName);
      }
    }
    return unresolved;
  }

  extractVariables(input: string): string[] {
    if (!input || !input.includes('{{')) { return []; }
    const regex = /\{\{([^}]+)\}\}/g;
    const vars: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      vars.push(match[1].trim());
    }
    return vars;
  }

  getCompletions(context: ResolutionContext): string[] {
    const userVars = [
      ...context.requestVars.map(v => v.key),
      ...context.collectionVars.map(v => v.key),
      ...(context.setsVars || []).map(v => v.key),
      ...context.globalVars.map(v => v.key),
    ];
    return [...new Set([...userVars])];
  }
}
