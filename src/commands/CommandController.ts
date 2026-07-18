import { randomUUID } from 'node:crypto';

export type CommandStartupAction =
  | { type: 'newRequest' }
  | { type: 'importCurl'; curlString: string }
  | { type: 'showCollections'; collectionId?: string }
  | { type: 'showHistory' }
  | { type: 'showVariables' }
  | { type: 'showCodeGeneration' };

export type CommandErrorCode =
  | 'CLIPBOARD_READ_FAILED'
  | 'INVALID_CLIPBOARD'
  | 'NO_COLLECTIONS'
  | 'FILE_READ_FAILED'
  | 'FILE_WRITE_FAILED'
  | 'INVALID_IMPORT'
  | 'INVALID_EXPORT'
  | 'STARTUP_ACTION_FAILED'
  | 'OPERATION_FAILED';

export interface CommandFailure {
  code: CommandErrorCode;
  message: string;
  details?: string[];
}

export type CommandResult =
  | { operationId: string; status: 'completed' }
  | { operationId: string; status: 'cancelled'; message: string }
  | { operationId: string; status: 'failed'; error: CommandFailure };

export interface CommandCollection {
  id: string;
  name: string;
  requestCount: number;
}

export interface CommandExport {
  collectionId: string;
  name: string;
  json: string;
}

export interface CommandTarget {
  runStartupAction(action: CommandStartupAction, operationId: string): Promise<void>;
  getCommandCollections(): Promise<CommandCollection[]>;
  exportCollectionForCommand(collectionId: string): Promise<CommandExport>;
  importCollectionForCommand(json: string): Promise<{ collectionId: string }>;
}

export interface CommandEnvironment {
  openView(): Promise<void>;
  readClipboard(): Promise<string>;
  pickCollection(collections: readonly CommandCollection[]): Promise<string | undefined>;
  openCollectionFile(): Promise<string | undefined>;
  saveCollectionFile(suggestedName: string, contents: string): Promise<boolean>;
}

export class CommandOperationError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly details?: string[]
  ) {
    super(message);
    this.name = 'CommandOperationError';
  }
}

export class CommandController {
  constructor(
    private readonly target: CommandTarget,
    private readonly environment: CommandEnvironment,
    private readonly createOperationId = () => `operation-${randomUUID()}`
  ) {}

  createRequest(): Promise<CommandResult> {
    return this.runStartupAction({ type: 'newRequest' });
  }

  async importCurl(): Promise<CommandResult> {
    const operationId = this.createOperationId();
    let curlString: string;
    try {
      curlString = await this.environment.readClipboard();
    } catch {
      return this.failed(operationId, new CommandOperationError(
        'CLIPBOARD_READ_FAILED',
        'JustAPI could not read the clipboard. Check clipboard permissions and try again.'
      ));
    }
    if (curlString.trim().length === 0) {
      return this.failed(operationId, new CommandOperationError(
        'INVALID_CLIPBOARD',
        'Copy a cURL command to the clipboard before running this command.'
      ));
    }
    return this.runStartupAction({ type: 'importCurl', curlString }, operationId);
  }

  async exportCollection(): Promise<CommandResult> {
    const operationId = this.createOperationId();
    try {
      const collections = await this.target.getCommandCollections();
      if (collections.length === 0) {
        throw new CommandOperationError(
          'NO_COLLECTIONS',
          'Create a collection before exporting.'
        );
      }
      const collectionId = await this.environment.pickCollection(collections);
      if (!collectionId) {
        return { operationId, status: 'cancelled', message: 'Collection export cancelled.' };
      }
      const exported = await this.target.exportCollectionForCommand(collectionId);
      let saved: boolean;
      try {
        saved = await this.environment.saveCollectionFile(exported.name, exported.json);
      } catch {
        throw new CommandOperationError(
          'FILE_WRITE_FAILED',
          'JustAPI could not write the collection file. Check the destination and permissions.'
        );
      }
      if (!saved) {
        return { operationId, status: 'cancelled', message: 'Collection export cancelled.' };
      }
      await this.openAndDeliver(
        { type: 'showCollections', collectionId: exported.collectionId },
        operationId
      );
      return { operationId, status: 'completed' };
    } catch (error) {
      return this.failed(operationId, error);
    }
  }

  async importCollection(): Promise<CommandResult> {
    const operationId = this.createOperationId();
    let json: string | undefined;
    try {
      json = await this.environment.openCollectionFile();
    } catch (error) {
      return this.failed(operationId, error instanceof CommandOperationError
        ? error
        : new CommandOperationError(
            'FILE_READ_FAILED',
            'JustAPI could not read the selected collection file. Check the file and permissions.'
          ));
    }
    if (json === undefined) {
      return { operationId, status: 'cancelled', message: 'Collection import cancelled.' };
    }
    try {
      const imported = await this.target.importCollectionForCommand(json);
      await this.openAndDeliver(
        { type: 'showCollections', collectionId: imported.collectionId },
        operationId
      );
      return { operationId, status: 'completed' };
    } catch (error) {
      return this.failed(operationId, error);
    }
  }

  openHistory(): Promise<CommandResult> {
    return this.runStartupAction({ type: 'showHistory' });
  }

  createVariable(): Promise<CommandResult> {
    return this.runStartupAction({ type: 'showVariables' });
  }

  generateCode(): Promise<CommandResult> {
    return this.runStartupAction({ type: 'showCodeGeneration' });
  }

  private async runStartupAction(
    action: CommandStartupAction,
    operationId = this.createOperationId()
  ): Promise<CommandResult> {
    try {
      await this.openAndDeliver(action, operationId);
      return { operationId, status: 'completed' };
    } catch (error) {
      return this.failed(operationId, error);
    }
  }

  private async openAndDeliver(
    action: CommandStartupAction,
    operationId: string
  ): Promise<void> {
    try {
      await this.environment.openView();
      await this.target.runStartupAction(action, operationId);
    } catch (error) {
      if (error instanceof CommandOperationError) {
        throw error;
      }
      throw new CommandOperationError(
        'STARTUP_ACTION_FAILED',
        'JustAPI could not deliver the command to its view. Reopen the sidebar and try again.'
      );
    }
  }

  private failed(operationId: string, error: unknown): CommandResult {
    const failure = error instanceof CommandOperationError
      ? error
      : new CommandOperationError(
          'OPERATION_FAILED',
          'The JustAPI command could not be completed.'
        );
    return {
      operationId,
      status: 'failed',
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
    };
  }
}
