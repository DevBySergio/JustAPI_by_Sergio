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
  constructor(
    private readonly manager: CollectionManager,
    private readonly auth: AuthService
  ) {}

  async load(): Promise<void> {
    await this.manager.load();
    await this.auth.migrateLegacyRequests(
      this.manager.getRequests(),
      requests => this.manager.replaceRequests(requests)
    );
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
    return request ? this.auth.toPublicRequest(request) : undefined;
  }

  getRequestsForCollection(collectionId: string): PersistedJustRequest[] {
    return this.manager.getRequestsForCollection(collectionId);
  }

  async saveRequest(
    request: JustRequest,
    collectionId: string,
    parentId?: string
  ): Promise<JustRequest | undefined> {
    const existing = this.manager.getRequest(request.id);
    const staged = await this.auth.stageRecognizedLegacyAuth(request, existing);
    const persisted = this.auth.prepareForSave(staged.request, existing);
    try {
      await this.manager.saveRequest(persisted, collectionId, parentId);
      await this.auth.commitSave(request.id, this.manager.getRequests());
    } catch (error) {
      await this.auth.rollbackSave(request.id);
      throw error;
    }
    return this.getRequest(request.id);
  }

  async deleteRequest(requestId: string, collectionId: string): Promise<void> {
    await this.manager.deleteRequest(requestId, collectionId);
  }

  async configureAuth(requestId: string, input: AuthInput): Promise<JustRequest['auth']> {
    return await this.auth.configure(requestId, input, this.manager.getRequest(requestId));
  }

  async createCollection(name: string): Promise<void> {
    await this.manager.createCollection(name);
  }

  async updateCollection(collection: Collection): Promise<void> {
    await this.manager.updateCollection(collection);
  }

  async deleteCollection(collectionId: string): Promise<void> {
    await this.manager.deleteCollection(collectionId);
  }

  async duplicateCollection(collectionId: string): Promise<void> {
    await this.manager.duplicateCollection(collectionId);
  }

  async renameCollection(collectionId: string, name: string): Promise<void> {
    const collection = this.manager.getCollection(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }
    collection.name = name;
    await this.manager.updateCollection(collection);
  }

  async moveItem(
    itemId: string,
    sourceCollectionId: string,
    targetCollectionId: string,
    targetParentId?: string,
    targetIndex?: number
  ): Promise<void> {
    await this.manager.moveItem(
      itemId,
      sourceCollectionId,
      targetCollectionId,
      targetParentId,
      targetIndex
    );
  }

  async stageImportedRequest(request: JustRequest): Promise<JustRequest> {
    return (await this.auth.stageRecognizedLegacyAuth(request)).request;
  }

  async cancelImportedRequest(requestId: string): Promise<void> {
    await this.auth.rollbackSave(requestId);
  }

  async exportDocument(
    collectionId: string,
    includeCredentials: boolean,
    confirmDisclosure: (destination: string) => Promise<boolean>
  ): Promise<CollectionExport> {
    const collection = this.manager.getCollection(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }
    const disclose = includeCredentials
      && await confirmDisclosure(`collection “${collection.name}” export`);
    const requests: JustRequest[] = [];
    for (const persisted of this.manager.getRequestsForCollection(collection.id)) {
      const request = this.auth.toPublicRequest(persisted);
      requests.push(disclose
        ? await this.auth.resolveForTransport(request, persisted)
        : this.auth.redactForDerivative(request));
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
  }

  async importDocument(json: string): Promise<{ collectionId: string }> {
    const validation = validateCollectionImportDocument(json);
    if (!validation.ok) {
      throw new CollectionTransferError(
        validation.code === 'MESSAGE_TOO_LARGE' ? 'MESSAGE_TOO_LARGE' : 'IMPORT_ERROR',
        validation.details
      );
    }
    const importedRequests = validation.value.requests
      .map(request => this.auth.prepareForImport(request));
    let imported = false;
    await this.auth.migrateLegacyRequests(importedRequests, async securedRequests => {
      await this.manager.importCollection(validation.value.collection, securedRequests);
      imported = true;
    });
    if (!imported) {
      await this.manager.importCollection(validation.value.collection, importedRequests);
    }
    return { collectionId: validation.value.collection.id };
  }
}
