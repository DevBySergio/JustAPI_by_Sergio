import { randomUUID } from 'node:crypto';
import { CurlParseError } from '../engine/http/CurlParser';
import { AuthServiceError } from '../engine/auth/AuthService';
import { CollectionIntegrityError } from '../engine/collection/CollectionGraph';
import {
  ExtensionMessage,
  ProtocolErrorCode,
  WebviewMessage,
} from '../models/MessageProtocol';
import {
  isProtocolIdentifier,
  protocolFailure,
  validateExtensionMessage,
  validateWebviewMessage,
} from './MessageValidator';
import { OperationRegistry } from './OperationRegistry';
import { ApplicationError } from '../services/ApplicationError';

export type ProtocolSender = (message: ExtensionMessage) => void;

export class WebviewProtocol {
  constructor(
    private readonly sendMessage: ProtocolSender,
    private readonly createOperationId: () => string = () => `operation-${randomUUID()}`
  ) {}

  post(message: ExtensionMessage): void {
    const validation = validateExtensionMessage(message);
    if (validation.ok) {
      this.sendMessage(validation.value);
      return;
    }

    const failure = protocolFailure('OUTBOUND_MESSAGE_INVALID');
    const operationId = isProtocolIdentifier(message.operationId)
      ? message.operationId
      : this.createOperationId();
    const executionId = 'executionId' in message && isProtocolIdentifier(message.executionId)
      ? message.executionId
      : undefined;
    this.sendMessage({
      type: 'error',
      operationId,
      ...(executionId ? { executionId } : {}),
      code: failure.code,
      message: failure.message,
    });
  }

  error(
    operationId: string,
    code: ProtocolErrorCode,
    executionId?: string,
    details?: string[]
  ): void {
    const failure = protocolFailure(code);
    this.post({
      type: 'error',
      operationId,
      ...(executionId ? { executionId } : {}),
      ...(details && details.length > 0 ? { details } : {}),
      code: failure.code,
      message: failure.message,
    });
  }

  acknowledge(message: WebviewMessage): void {
    const executionId = executionIdOf(message);
    this.post({
      type: 'acknowledgement',
      operationId: message.operationId,
      action: message.type,
      status: 'completed',
      ...(executionId ? { executionId } : {}),
    });
  }

  operationIdOf(rawMessage: unknown): string {
    if (rawMessage !== null && typeof rawMessage === 'object' && 'operationId' in rawMessage) {
      const operationId = (rawMessage as { operationId?: unknown }).operationId;
      if (isProtocolIdentifier(operationId)) {
        return operationId;
      }
    }
    return this.createOperationId();
  }
}

export class WebviewMessageRouter {
  constructor(
    private readonly protocol: WebviewProtocol,
    private readonly dispatch: (message: WebviewMessage) => Promise<void>,
    private readonly operations = new OperationRegistry(),
    private readonly finalize: (message: WebviewMessage) => void | Promise<void> = () => undefined
  ) {}

  async handle(rawMessage: unknown): Promise<void> {
    const validation = validateWebviewMessage(rawMessage);
    if (!validation.ok) {
      this.protocol.error(this.protocol.operationIdOf(rawMessage), validation.code);
      return;
    }

    const message = validation.value;
    if (!this.operations.claim(message.operationId)) {
      this.protocol.error(
        message.operationId,
        'DUPLICATE_OPERATION',
        executionIdOf(message)
      );
      return;
    }

    try {
      await this.dispatch(message);
      await this.finalize(message);
      this.protocol.acknowledge(message);
    } catch (error) {
      const failure = mapProtocolError(error, message);
      this.protocol.error(
        message.operationId,
        failure.code,
        failure.executionId ?? executionIdOf(message),
        failure.details
      );
      try {
        await this.finalize(message);
      } catch {
        // Preserve the primary operation failure after best-effort cleanup.
      }
    }
  }
}

export function executionIdOf(message: WebviewMessage): string | undefined {
  return 'executionId' in message ? message.executionId : undefined;
}

export function mapProtocolError(
  error: unknown,
  message: WebviewMessage
): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }
  if (error instanceof CurlParseError) {
    const suffix = error.tokenIndex === undefined ? '' : ` at token ${error.tokenIndex}`;
    return new ApplicationError('CURL_PARSE_ERROR', [`${error.code}${suffix}`]);
  }
  if (error instanceof CollectionIntegrityError) {
    return new ApplicationError(
      message.type === 'importCollection' ? 'IMPORT_ERROR' : 'OPERATION_FAILED',
      error.issues.map(issue => issue.entityId
        ? `${issue.code}: ${issue.entityId}`
        : issue.code)
    );
  }
  if (error instanceof AuthServiceError && error.code !== 'AUTH_INVALID') {
    return new ApplicationError(error.code);
  }
  return new ApplicationError('OPERATION_FAILED');
}
