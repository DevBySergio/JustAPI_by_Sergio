import type { WebviewMessageType } from '../models/MessageProtocol';

export class OperationCorrelationTracker {
  private readonly latestOperationByGroup = new Map<string, string>();
  private readonly groupByOperation = new Map<string, string>();

  constructor(private readonly recentLimit = 1_000) {}

  record(action: WebviewMessageType, operationId: string): void {
    const group = this.groupFor(action);
    this.latestOperationByGroup.set(group, operationId);
    this.groupByOperation.set(operationId, group);
    while (this.groupByOperation.size > this.recentLimit) {
      const oldest = this.groupByOperation.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.groupByOperation.delete(oldest);
    }
  }

  isCurrent(operationId: string): boolean {
    const group = this.groupByOperation.get(operationId);
    return group === undefined || this.latestOperationByGroup.get(group) === operationId;
  }

  private groupFor(action: WebviewMessageType): string {
    switch (action) {
      case 'saveRequest':
      case 'deleteRequest':
      case 'getCollections':
      case 'createCollection':
      case 'updateCollection':
      case 'deleteCollection':
      case 'duplicateCollection':
      case 'renameCollection':
      case 'moveItem':
      case 'importCollection':
        return 'collections';
      case 'getHistory':
      case 'clearHistory':
      case 'deleteHistoryEntry':
        return 'history';
      case 'getVariables':
      case 'setGlobalVariables':
        return 'variables';
      case 'getSettings':
      case 'setSettings':
        return 'settings';
      case 'getVariableSets':
      case 'createVariableSet':
      case 'updateVariableSet':
      case 'deleteVariableSet':
      case 'linkVariableSet':
      case 'unlinkVariableSet':
        return 'variableSets';
      case 'startupActionHandled':
        return 'startupActions';
      default:
        return action;
    }
  }
}

export function isActiveExecution(
  activeExecutionId: string | null,
  incomingExecutionId: string
): boolean {
  return activeExecutionId === incomingExecutionId;
}
