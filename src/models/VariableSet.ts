import { Variable } from './Variable';

export interface VariableSet {
  id: string;
  name: string;
  variables: Variable[];
  linkedCollectionIds: string[];
  created: number;
  updated: number;
}

export function createDefaultVariableSet(name: string): VariableSet {
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
