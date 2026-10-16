import { RequestFileService } from './RequestFileService';
import { assertNoAuthConflict, AuthService, AuthServiceError } from '../engine/auth/AuthService';
import { EffectiveRequestError, normalizeEffectiveRequest } from '../engine/http/EffectiveRequest';
import { ResolutionContext, VariableEngine } from '../engine/variables/VariableEngine';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import { JustRequest } from '../models/Request';
import { RequestResolutionResult, VariableDiagnostic } from '../models/VariableResolution';
import { CollectionService } from './CollectionService';
import { PersistenceService } from './PersistenceService';
import { preflightError } from './ApplicationError';
import type { VariableSet } from '../models/VariableSet';

export interface ResolutionPreview {
  resolvedUrl: string;
  resolvedHeaders: string;
  resolvedQueryParams: string;
  resolvedBody: string;
  diagnostics: VariableDiagnostic[];
  canExecute: boolean;
}

export interface RequestPreparation {
  capture?(): RequestPreparation;
  resolve(request: JustRequest, collectionId?: string): Promise<RequestResolutionResult>;
  resolveForTransport(request: JustRequest, collectionId?: string): Promise<JustRequest>;
  redactForDerivative(request: JustRequest): JustRequest;
  preview(request: JustRequest | null, collectionId?: string): Promise<ResolutionPreview>;
}

export class RequestPreparationService implements RequestPreparation {
  constructor(
    private readonly variableEngine: VariableEngine,
    private readonly collections: CollectionService,
    private readonly variableSets: VariableSetManager,
    private readonly persistence: PersistenceService,
    private readonly auth: AuthService,
    private readonly setsSnapshot?: VariableSet[],
    private readonly files?: RequestFileService
  ) {}

  capture(): RequestPreparation {
    return new RequestPreparationService(this.variableEngine, this.collections, this.variableSets, this.persistence, this.auth,
      this.setsSnapshot ?? this.variableSets.getAll(), this.files);
  }

  async resolve(request: JustRequest, collectionId?: string): Promise<RequestResolutionResult> {
    const result = this.resolveWithContext(request, await this.buildResolutionContext(request, collectionId));
    return await this.validateFiles(result);
  }

  private resolveWithContext(request: JustRequest, context: ResolutionContext): RequestResolutionResult {
    const result = this.variableEngine.resolveRequest(request, context);
    if (result.ok) {
      try { normalizeEffectiveRequest(result.request); assertNoAuthConflict(result.request); }
      catch (error) {
        if (!(error instanceof EffectiveRequestError) && !(error instanceof AuthServiceError)) { throw error; }
        result.ok = false;
        result.diagnostics.push({ code: error instanceof AuthServiceError ? 'AUTH_CONFLICT' : error.code, location: error instanceof AuthServiceError ? 'auth' : error.code === 'INVALID_URL' ? 'url' : error.code === 'INVALID_PATH_PARAMETER' ? 'pathParams' : error.code === 'INVALID_BODY' ? 'body' : 'headers' });
      }
    }
    return result;
  }

  async resolveForTransport(request: JustRequest, collectionId?: string): Promise<JustRequest> {
    const context = await this.buildResolutionContext(request, collectionId);
    const preflight = await this.validateFiles(this.resolveWithContext(request, context));
    if (!preflight.ok) {
      throw preflightError(preflight.diagnostics);
    }
    const prepared = await this.auth.resolveForTransport(
      preflight.request,
      this.collections.getPersistedRequest(request.id),
      request.auth,
      { resolveValue: value => {
        const resolved = this.variableEngine.resolveDetailed(value, context, undefined, 'auth');
        if (resolved.diagnostics.length) { throw preflightError(resolved.diagnostics); }
        return resolved.value;
      } }
    );
    normalizeEffectiveRequest(prepared);
    return prepared;
  }

  private async validateFiles(result: RequestResolutionResult): Promise<RequestResolutionResult> {
    if (result.ok && this.files) { result.diagnostics.push(...await this.files.validate(result.request)); result.ok = result.diagnostics.length === 0; }
    return result;
  }

  redactForDerivative(request: JustRequest): JustRequest {
    return this.auth.redactForDerivative(request);
  }

  async preview(request: JustRequest | null, collectionId?: string): Promise<ResolutionPreview> {
    const source = request;
    const preflight = source ? await this.resolve(source, collectionId) : null;
    const resolvedRequest = preflight ? this.auth.redactForDerivative(preflight.request) : undefined;
    let effectiveRequest: ReturnType<typeof normalizeEffectiveRequest> | undefined;
    if (resolvedRequest) {
      try {
        effectiveRequest = normalizeEffectiveRequest(resolvedRequest, {
          credentialRepresentation: 'placeholder',
        });
      } catch {
        // Preserve editor values while diagnostics explain why execution is blocked.
      }
    }
    const resolvedHeaders = effectiveRequest?.headers
      .map(({ name: key, value }) => ({ key, value }))
      ?? (resolvedRequest?.headers ?? [])
        .filter(header => header.enabled)
        .map(({ key, value }) => ({ key, value }));
    const resolvedQueryParams = (resolvedRequest?.queryParams ?? [])
      .filter(parameter => parameter.enabled)
      .map(({ key, value }) => ({ key, value }));
    const resolvedBody = effectiveRequest?.body.type === 'file' ? JSON.stringify({ file: effectiveRequest.body.file.name, bytes: effectiveRequest.body.file.size, contentType: effectiveRequest.body.contentType }, null, 2) : effectiveRequest
      && (effectiveRequest.body.type === 'form-data'
        || effectiveRequest.body.type === 'x-www-form-urlencoded')
      ? JSON.stringify(
          [...effectiveRequest.body.fields.map(({ name: key, value }) => ({ key, value })), ...(effectiveRequest.body.type === 'form-data' ? effectiveRequest.body.files ?? [] : []).map(field => ({ key: field.name, file: field.file.name, bytes: field.file.size, contentType: field.contentType }))],
          null,
          2
        )
      : effectiveRequest?.body.content ?? resolvedRequest?.body.content ?? '';
    return {
      resolvedUrl: effectiveRequest?.url ?? resolvedRequest?.url ?? '',
      resolvedHeaders: JSON.stringify(resolvedHeaders, null, 2),
      resolvedQueryParams: JSON.stringify(resolvedQueryParams, null, 2),
      resolvedBody,
      diagnostics: preflight?.diagnostics ?? [],
      canExecute: Boolean(preflight?.ok && effectiveRequest),
    };
  }

  private async buildResolutionContext(
    request: JustRequest | null,
    collectionId?: string
  ): Promise<ResolutionContext> {
    const sets = this.setsSnapshot ?? this.variableSets.getAll();
    const linkedSets = collectionId ? sets.filter(set => set.kind !== 'environment' && set.linkedCollectionIds.includes(collectionId)) : [];
    return {
      requestVars: request?.variables ?? [],
      collectionVars: collectionId
        ? this.collections.getCollection(collectionId)?.variables ?? []
        : [],
      setsVars: linkedSets.flatMap(set => set.variables),
      environmentVars: sets.find(set => set.kind === 'environment' && set.active)?.variables ?? [],
      globalVars: await this.persistence.loadVariables(),
    };
  }
}
