import type { Collection } from '../models/Collection';
import type { HistoryEntry } from '../models/HistoryEntry';
import type { SearchResult } from '../models/MessageProtocol';

const MAXIMUM_SEARCH_RESULTS = 500;
const MAXIMUM_SEARCH_NAME_LENGTH = 1_024;

function boundedName(value: string): string {
  return value.slice(0, MAXIMUM_SEARCH_NAME_LENGTH);
}

export function buildSearchResults(
  collections: Collection[],
  getRequest: (requestId: string) => { url: string } | undefined,
  history: HistoryEntry[],
  query: string
): SearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (result: SearchResult): void => {
    const key = `${result.type}:${result.id}:${result.collectionId ?? ''}`;
    if (results.length < MAXIMUM_SEARCH_RESULTS && !seen.has(key)) {
      seen.add(key);
      results.push(result);
    }
  };

  const searchItems = (items: Collection['items'], collectionId: string): void => {
    for (const item of items) {
      if (item.type === 'request' && item.requestId) {
        const request = getRequest(item.requestId);
        const nameMatches = item.name.toLowerCase().includes(normalizedQuery);
        const urlMatches = request?.url.toLowerCase().includes(normalizedQuery) === true;
        if (nameMatches || urlMatches) {
          add({
            type: 'request',
            id: item.requestId,
            name: boundedName(item.name),
            collectionId,
            ...(request?.url ? { url: request.url } : {}),
            matchField: urlMatches ? 'url' : 'name',
          });
        }
      } else {
        if (item.name.toLowerCase().includes(normalizedQuery)) {
          add({
            type: 'folder',
            id: item.id,
            name: boundedName(item.name),
            collectionId,
            matchField: 'name',
          });
        }
        if (item.items) {
          searchItems(item.items, collectionId);
        }
      }
    }
  };

  for (const collection of collections) {
    if (collection.name.toLowerCase().includes(normalizedQuery)) {
      add({
        type: 'collection',
        id: collection.id,
        name: boundedName(collection.name),
        collectionId: collection.id,
        matchField: 'name',
      });
    }
    searchItems(collection.items, collection.id);
  }

  for (const entry of history) {
    if (entry.url.toLowerCase().includes(normalizedQuery)
      || entry.method.toLowerCase().includes(normalizedQuery)) {
      add({
        type: 'history',
        id: entry.id,
        name: boundedName(`${entry.method} ${entry.url}`),
        ...(entry.collectionId ? { collectionId: entry.collectionId } : {}),
        ...(entry.requestId ? { requestId: entry.requestId } : {}),
        url: entry.url,
        matchField: 'url',
      });
    }
  }

  return results;
}
