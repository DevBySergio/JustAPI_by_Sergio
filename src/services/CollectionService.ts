import { RequestFileService, withoutRequestFiles } from './RequestFileService';
import { SerialQueue } from '../utils/SerialQueue';
import { assertCollectionGraph } from '../engine/collection/CollectionGraph';
import { AuthInput } from '../models/Auth';
import { Collection } from '../models/Collection';
import { COLLECTION_TRANSFER_SCHEMA_VERSION } from '../models/CollectionTransfer';
import { JustRequest, PersistedJustRequest } from '../models/Request';
import { validateCollectionImportDocument } from '../protocol/MessageValidator';
import { AuthService } from '../engine/auth/AuthService';
import { CollectionManager } from '../engine/collection/CollectionManager';
import { ApplicationError } from './ApplicationError';

export type CollectionTransferErrorCode = 'MESSAGE_TOO_LARGE' | 'IMPORT_ERROR';

export class CollectionTransferError extends ApplicationError {
  constructor(
    readonly code: CollectionTransferErrorCode,
    readonly details?: string[]
  ) {
    super(code, details);
    this.name = 'CollectionTransferError';
  }
}

export interface CollectionExport {
  collectionId: string;
  name: string;
  json: string;
}

export class CollectionService {
  private readonly operations = new SerialQueue();
  constructor(
    private readonly manager: CollectionManager,
    private readonly auth: AuthService,
    private readonly files?: RequestFileService
  ) {}

  async dispose(): Promise<void> { await this.operations.close(); }

  async load(): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.load();
      await this.auth.migrateLegacyRequests(
        this.manager.getRequests(),
        requests => this.manager.replaceRequests(requests)
      );
    });
  }

  getCollections(): Collection[] {
    return this.manager.getCollections();
  }

  getCollection(collectionId: string): Collection | undefined {
    return this.manager.getCollection(collectionId);
  }

  getPersistedRequest(requestId: string): PersistedJustRequest | undefined {
    return this.manager.getRequest(requestId);
  }

  getRequest(requestId: string): JustRequest | undefined {
    const request = this.manager.getRequest(requestId);
    return request ? (this.files?.forEditor(this.auth.toPublicRequest(request)) ?? this.auth.toPublicRequest(request)) : undefined;
  }

  getRequestsForCollection(collectionId: string): PersistedJustRequest[] {
    return this.manager.getRequestsForCollection(collectionId);
  }

  async saveRequest(
    request: JustRequest,
    collectionId: string,
    parentId?: string
  ): Promise<JustRequest | undefined> {
    return this.operations.run(async () => {
      const existing = this.manager.getRequest(request.id);
      const staged = await this.auth.stageRecognizedLegacyAuth(request, existing);
      const persisted = this.auth.prepareForSave(staged.request, existing);
      await this.manager.saveRequest(persisted, collectionId, parentId);
      await this.auth.commitSave(request.id, this.manager.getRequests());
      return this.getRequest(request.id);
    });
  }

  async deleteRequest(requestId: string, collectionId: string): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.deleteRequest(requestId, collectionId);
    });
  }

  async discardRequestChanges(requestId: string): Promise<void> {
    return this.operations.run(async () => {
      await this.auth.rollbackSave(requestId);
    });
  }

  async discardAllPendingAuth(): Promise<void> {
    return this.operations.run(async () => { await this.auth.dispose(); });
  }

  hasPendingAuth(requestId: string): boolean { return this.auth.hasPendingChanges(requestId); }

  async configureAuth(requestId: string, input: AuthInput): Promise<JustRequest['auth']> {
    return this.operations.run(async () => {
      return await this.auth.configure(requestId, input, this.manager.getRequest(requestId));
    });
  }

  async createCollection(name: string): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.createCollection(name);
    });
  }

  async updateCollection(collection: Collection): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.updateCollection(collection);
    });
  }

  async updateCollectionVariables(collectionId: string, variables: Collection['variables']): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.updateVariables(collectionId, variables);
    });
  }

  async deleteCollection(collectionId: string): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.deleteCollection(collectionId);
    });
  }

  async duplicateCollection(collectionId: string): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.duplicateCollection(collectionId);
    });
  }

  async renameCollection(collectionId: string, name: string): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.renameCollection(collectionId, name);
    });
  }

  async moveItem(
    itemId: string,
    sourceCollectionId: string,
    targetCollectionId: string,
    targetParentId?: string,
    targetIndex?: number
  ): Promise<void> {
    return this.operations.run(async () => {
      await this.manager.moveItem(
        itemId,
        sourceCollectionId,
        targetCollectionId,
        targetParentId,
        targetIndex
      );
    });
  }

  async createFolder(collectionId: string, name: string, parentId?: string): Promise<void> {
    return this.operations.run(async () => { await this.manager.addFolder(collectionId, name, parentId); });
  }

  async renameFolder(collectionId: string, folderId: string, name: string): Promise<void> {
    return this.operations.run(async () => { await this.manager.renameFolder(collectionId, folderId, name); });
  }

  async deleteFolder(collectionId: string, folderId: string): Promise<void> {
    return this.operations.run(async () => { await this.manager.deleteFolder(collectionId, folderId); });
  }

  async stageImportedRequest(request: JustRequest): Promise<JustRequest> {
    return this.operations.run(async () => {
      return (await this.auth.stageRecognizedLegacyAuth(request)).request;
    });
  }

  async cancelImportedRequest(requestId: string): Promise<void> {
    return this.operations.run(async () => {
      await this.auth.rollbackSave(requestId);
    });
  }

  async exportDocument(
    collectionId: string,
    includeCredentials: boolean,
    confirmDisclosure: (destination: string) => Promise<boolean>
  ): Promise<CollectionExport> {
    return this.operations.run(async () => {
      const collection = this.manager.getCollection(collectionId);
      if (!collection) {
        throw new Error('Collection not found');
      }
      const disclose = includeCredentials
        && await confirmDisclosure(`collection “${collection.name}” export`);
      const requests: JustRequest[] = [];
      for (const persisted of this.manager.getRequestsForCollection(collection.id)) {
        const request = this.auth.toPublicRequest(persisted);
        requests.push(withoutRequestFiles(disclose
          ? await this.auth.resolveForTransport(request, persisted, request.auth, { usePending: false })
          : this.auth.redactForDerivative(request)));
      }
      const json = JSON.stringify({
        schemaVersion: COLLECTION_TRANSFER_SCHEMA_VERSION,
        collection,
        requests,
      }, null, 2);
      const validation = validateCollectionImportDocument(json);
      if (!validation.ok) {
        throw new CollectionTransferError(
          validation.code === 'MESSAGE_TOO_LARGE' ? 'MESSAGE_TOO_LARGE' : 'IMPORT_ERROR',
          validation.details
        );
      }
      return { collectionId: collection.id, name: collection.name, json };
    });
  }

  async importDocument(json: string, authInputs?: ReadonlyMap<string, AuthInput>): Promise<{ collectionId: string }> {
    return this.operations.run(async () => {
      const validation = validateCollectionImportDocument(json);
      if (!validation.ok) {
        throw new CollectionTransferError(
          validation.code === 'MESSAGE_TOO_LARGE' ? 'MESSAGE_TOO_LARGE' : 'IMPORT_ERROR',
          validation.details
        );
      }
      assertCollectionGraph(
        [...this.manager.getCollections(), validation.value.collection],
        [...this.manager.getRequests(), ...validation.value.requests]
      );
      await this.auth.importRequests(validation.value.requests.map(withoutRequestFiles), async requests => {
        await this.manager.importCollection(validation.value.collection, requests);
      }, authInputs);
      return { collectionId: validation.value.collection.id };
    });
  }
}
