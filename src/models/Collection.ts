import { Variable } from './Variable';

export interface CollectionItemRef {
  type: 'folder' | 'request';
  id: string;
  name: string;
  items?: CollectionItemRef[];
  requestId?: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  items: CollectionItemRef[];
  variables: Variable[];
  created: number;
  updated: number;
}

export function createDefaultCollection(name: string): Collection {
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
