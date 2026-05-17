export type VariableScope = 'request' | 'collection' | 'global';

export interface Variable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  scope: VariableScope;
}

export interface VariableGroup {
  global: Variable[];
  collection: Variable[];
  request: Variable[];
}
