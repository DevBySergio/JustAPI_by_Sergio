import { Variable } from './Variable';

export interface VariableSet {
  id: string;
  name: string;
  variables: Variable[];
  linkedCollectionIds: string[];
  created: number;
  updated: number;
  kind?: 'environment';
  active?: boolean;
}

export function createDefaultVariableSet(name: string, id: string = crypto.randomUUID()): VariableSet {
  const now = Date.now();
  return {
    id,
    name,
    variables: [],
    linkedCollectionIds: [],
    created: now,
    updated: now,
  };
}
