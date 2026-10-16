import { ResponseDownloadService } from './ResponseDownloadService';
import { HttpClient } from '../engine/http/HttpClient';
import { ExtensionMessage, WebviewMessage } from '../models/MessageProtocol';
import { JustRequest } from '../models/Request';
import { JustResponse } from '../models/Response';
import { ExecutionRegistry } from '../protocol/OperationRegistry';
import { ApplicationError, preflightError } from './ApplicationError';
import { CollectionService } from './CollectionService';
import { HistoryService } from './HistoryService';
import { RequestPreparation } from './RequestPreparationService';

export interface RequestTransport {
  cancel(): void;
  takeResponseBody?(): Buffer | undefined;
  execute(request: JustRequest): Promise<JustResponse>;
}

export type RequestEventSink = (message: ExtensionMessage) => void;

export class RequestService {
  constructor(
    private readonly preparation: RequestPreparation,
    private readonly collections: CollectionService,
    private readonly history: HistoryService,
    private readonly executions = new ExecutionRegistry(),
    private readonly createTransport: () => RequestTransport = () => new HttpClient(),
    private readonly downloads?: ResponseDownloadService
  ) {}

  async execute(
    message: Extract<WebviewMessage, { type: 'executeRequest' }>,
    emit: RequestEventSink
  ): Promise<void> {
    const client = this.createTransport();
    const execution = this.executions.register(message.operationId, message.executionId, client);
    if (!execution) {
      throw new ApplicationError(
        'DUPLICATE_EXECUTION',
        undefined,
        message.executionId
      );
    }
    this.emitReleased(this.downloads?.releaseRequest(message.request.id) ?? [], message.operationId, emit);
    emit({
      type: 'requestExecuting',
      operationId: message.operationId,
      executionId: message.executionId,
      executing: true,
    });

    try {
      const preparation = this.preparation.capture?.() ?? this.preparation;
      const preflight = await preparation.resolve(message.request, message.collectionId);
      if (execution.cancelled) { return; }
      if (!preflight.ok) {
        throw preflightError(preflight.diagnostics, message.executionId);
      }
      const request = await preparation.resolveForTransport(
        message.request,
        message.collectionId
      );
      if (execution.cancelled) { return; }
      const response = await client.execute(request);
      const bytes = client.takeResponseBody?.();
      if (execution.cancelled) {
        return;
      }
      if (this.downloads && bytes && !response.error && response.statusCode > 0) {
        const retained = this.downloads.retain(message.request.id, bytes, response);
        response.download = retained.download; this.emitReleased(retained.released, message.operationId, emit);
      }
      emit({
        type: 'response',
        operationId: message.operationId,
        executionId: message.executionId,
        response,
      });
      if (response.statusCode > 0) {
        const hasSavedRequest = message.collectionId !== undefined
          && this.collections.getPersistedRequest(message.request.id) !== undefined;
        const entry = await this.history.record(message.request, response, {
          collectionId: message.collectionId,
          hasSavedRequest,
        });
        emit({
          type: 'historyEntry',
          operationId: message.operationId,
          executionId: message.executionId,
          entry,
        });
      }
    } catch (error) {
      if (!execution.cancelled) {
        throw error;
      }
    }
  }

  finalize(operationId: string, executionId: string, emit: RequestEventSink): void {
    const execution = this.executions.get(executionId);
    if (!execution || execution.operationId !== operationId) {
      return;
    }
    this.executions.complete(executionId);
    emit({
      type: 'requestExecuting',
      operationId,
      executionId,
      executing: false,
    });
  }

  cancel(operationId: string, executionId: string, emit: RequestEventSink): void {
    const execution = this.executions.cancel(executionId);
    if (!execution) {
      throw new ApplicationError('EXECUTION_NOT_FOUND', undefined, executionId);
    }
    emit({
      type: 'requestExecuting',
      operationId: execution.operationId || operationId,
      executionId: execution.executionId,
      executing: false,
    });
  }

  private emitReleased(responseIds: string[], operationId: string, emit: RequestEventSink): void {
    if (responseIds.length) { emit({ type: 'responseBodiesReleased', operationId, responseIds }); }
  }

  dispose(): void {
    this.downloads?.reset();
    this.executions.cancelAll();
  }
}
