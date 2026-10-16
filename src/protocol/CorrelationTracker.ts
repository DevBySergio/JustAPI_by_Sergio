import type { WebviewMessageType } from '../models/MessageProtocol';

const READ_GROUPS: Partial<Record<WebviewMessageType, string>> = {
  getCollections: 'collections', getHistory: 'history', getVariables: 'variables',
  getSettings: 'settings', getVariableSets: 'variableSets', getRequest: 'request',
  previewResolution: 'preview', search: 'search', generateCode: 'code',
};
const MUTATION_GROUPS: Partial<Record<WebviewMessageType, string>> = {
  saveRequest: 'collections', deleteRequest: 'collections', createCollection: 'collections',
  updateCollection: 'collections', setCollectionVariables: 'collections', deleteCollection: 'collections',
  duplicateCollection: 'collections', renameCollection: 'collections', moveItem: 'collections',
  createFolder: 'collections', renameFolder: 'collections', deleteFolder: 'collections',
  importCollection: 'collections', clearHistory: 'history', deleteHistoryEntry: 'history',
  setGlobalVariables: 'variables', setSettings: 'settings', createVariableSet: 'variableSets',
  updateVariableSet: 'variableSets', deleteVariableSet: 'variableSets', linkVariableSet: 'variableSets',
  unlinkVariableSet: 'variableSets',
};

export class OperationCorrelationTracker {
  private readonly latestOperationByGroup = new Map<string, string>();
  private readonly groupByOperation = new Map<string, string>();

  constructor(private readonly recentLimit = 1_000) {}

  record(action: WebviewMessageType, operationId: string): void {
    const readGroup = READ_GROUPS[action];
    const invalidatedGroup = MUTATION_GROUPS[action];
    if (invalidatedGroup) { this.latestOperationByGroup.set(invalidatedGroup, operationId); }
    // A mutation always owns its acknowledgement and errors. Only queries supersede queries.
    if (readGroup) {
      this.latestOperationByGroup.set(readGroup, operationId);
      this.groupByOperation.set(operationId, readGroup);
    }
    while (this.groupByOperation.size > this.recentLimit) {
      const oldest = this.groupByOperation.keys().next().value as string | undefined;
      if (oldest === undefined) { break; }
      this.groupByOperation.delete(oldest);
    }
  }

  isCurrent(operationId: string): boolean {
    const group = this.groupByOperation.get(operationId);
    return group === undefined || this.latestOperationByGroup.get(group) === operationId;
  }
}

export function isActiveExecution(activeExecutionId: string | null, incomingExecutionId: string): boolean {
  return activeExecutionId === incomingExecutionId;
}
