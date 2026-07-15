import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { AuthConfig, AuthInput, PersistedAuthConfig, toPublicAuth } from '../../models/Auth';
import { JustRequest, PersistedJustRequest } from '../../models/Request';

export interface SecretStorageLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface CredentialDisclosure {
  destination: string;
  warning: string;
}

export type AuthErrorCode = 'AUTH_CONFLICT' | 'AUTH_SECRET_NOT_FOUND' | 'AUTH_INVALID';

export class AuthServiceError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthServiceError';
  }
}

type StoredSecret =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; value: string };

interface StagedAuth {
  config: PersistedAuthConfig;
  newSecretRef?: string;
  previousSecretRef?: string;
}

interface LegacyAuthMatch {
  headerIndex: number;
  input: Exclude<AuthInput, { type: 'none' }>;
}

export interface LegacyAuthStageResult {
  request: JustRequest;
  migrated: boolean;
}

const SECRET_PREFIX = 'justapi.auth.v1';
const PLACEHOLDERS = {
  bearer: '<BEARER_TOKEN>',
  basic: '<BASIC_CREDENTIALS>',
  apiKey: '<API_KEY>',
  conflict: '<AUTH_CONFLICT>',
  redacted: '<REDACTED>',
} as const;

function cloneRequest<T extends JustRequest | PersistedJustRequest>(request: T): T {
  return JSON.parse(JSON.stringify(request)) as T;
}

function secretRefOf(config: PersistedAuthConfig | undefined): string | undefined {
  return config && config.type !== 'none' ? config.secretRef : undefined;
}

function publicAuthMatches(persisted: PersistedAuthConfig, publicAuth: AuthConfig): boolean {
  if (persisted.type !== publicAuth.type) {
    return false;
  }
  return persisted.type !== 'apiKey'
    || (publicAuth.type === 'apiKey'
      && persisted.name === publicAuth.name
      && persisted.in === publicAuth.in);
}

function isPersistedAuth(value: unknown): value is PersistedAuthConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const auth = value as Record<string, unknown>;
  if (auth.type === 'none') {
    return Object.keys(auth).length === 1;
  }
  if ((auth.type === 'bearer' || auth.type === 'basic')
    && typeof auth.secretRef === 'string'
    && auth.secretRef.startsWith(`${SECRET_PREFIX}.`)) {
    return Object.keys(auth).length === 2;
  }
  return auth.type === 'apiKey'
    && typeof auth.name === 'string'
    && (auth.in === 'header' || auth.in === 'query')
    && typeof auth.secretRef === 'string'
    && auth.secretRef.startsWith(`${SECRET_PREFIX}.`)
    && Object.keys(auth).length === 4;
}

export function normalizePersistedRequest(
  request: PersistedJustRequest | JustRequest | (Omit<JustRequest, 'auth'> & { auth?: unknown })
): PersistedJustRequest {
  const auth = isPersistedAuth(request.auth) ? request.auth : { type: 'none' } as const;
  return { ...cloneRequest(request as JustRequest), auth };
}

export class AuthService {
  private readonly staged = new Map<string, StagedAuth>();

  constructor(private readonly secrets: SecretStorageLike) {}

  toPublicRequest(request: PersistedJustRequest): JustRequest {
    const copy = cloneRequest(request);
    return { ...copy, auth: toPublicAuth(request.auth) };
  }

  async configure(
    requestId: string,
    input: AuthInput,
    existing?: PersistedJustRequest
  ): Promise<AuthConfig> {
    this.validateInput(input);
    const priorStage = this.staged.get(requestId);
    const previousSecretRef = priorStage?.previousSecretRef ?? secretRefOf(existing?.auth);
    if (input.type === 'none') {
      if (priorStage?.newSecretRef) {
        await this.secrets.delete(priorStage.newSecretRef);
      }
      const config: PersistedAuthConfig = { type: 'none' };
      this.staged.set(requestId, { config, previousSecretRef });
      return { type: 'none' };
    }

    const secretRef = this.createSecretRef(requestId);
    const secret = this.secretFromInput(input);
    await this.secrets.store(secretRef, JSON.stringify(secret));
    if (priorStage?.newSecretRef) {
      try {
        await this.secrets.delete(priorStage.newSecretRef);
      } catch (error) {
        await this.secrets.delete(secretRef);
        throw error;
      }
    }
    const config = this.persistedConfig(input, secretRef);
    this.staged.set(requestId, {
      config,
      newSecretRef: secretRef,
      previousSecretRef,
    });
    return toPublicAuth(config);
  }

  prepareForSave(request: JustRequest, existing?: PersistedJustRequest): PersistedJustRequest {
    const staged = this.staged.get(request.id);
    let auth: PersistedAuthConfig;
    if (staged) {
      auth = staged.config;
    } else if (existing && publicAuthMatches(existing.auth, request.auth)) {
      auth = existing.auth;
    } else if (request.auth.type === 'none' && (!existing || existing.auth.type === 'none')) {
      auth = { type: 'none' };
    } else {
      throw new AuthServiceError('AUTH_SECRET_NOT_FOUND');
    }
    return { ...cloneRequest(request), auth };
  }

  async stageRecognizedLegacyAuth(
    request: JustRequest,
    existing?: PersistedJustRequest
  ): Promise<LegacyAuthStageResult> {
    if (request.auth.type !== 'none') {
      return { request, migrated: false };
    }
    const candidate = normalizePersistedRequest(request);
    const match = this.findLegacyAuth(candidate);
    if (!match) {
      return { request, migrated: false };
    }
    const auth = await this.configure(request.id, match.input, existing);
    const safeRequest = cloneRequest(request);
    safeRequest.headers.splice(match.headerIndex, 1);
    safeRequest.auth = auth;
    return { request: safeRequest, migrated: true };
  }

  async commitSave(requestId: string, persistedRequests: readonly PersistedJustRequest[]): Promise<void> {
    const staged = this.staged.get(requestId);
    if (!staged) {
      return;
    }
    this.staged.delete(requestId);
    if (staged.previousSecretRef && staged.previousSecretRef !== staged.newSecretRef) {
      await this.deleteIfUnreferenced(staged.previousSecretRef, persistedRequests);
    }
  }

  async rollbackSave(requestId: string): Promise<void> {
    const staged = this.staged.get(requestId);
    this.staged.delete(requestId);
    if (staged?.newSecretRef) {
      await this.secrets.delete(staged.newSecretRef);
    }
  }

  async resolveForTransport(
    request: JustRequest,
    existing?: PersistedJustRequest
  ): Promise<JustRequest> {
    const persisted = this.resolveConfig(request, existing);
    if (persisted.type === 'none') {
      return cloneRequest(request);
    }
    const secret = await this.readSecret(persisted);
    return this.injectCredential(request, persisted, secret);
  }

  redactForDerivative(request: JustRequest): JustRequest {
    const copy = cloneRequest(request);
    for (const header of copy.headers) {
      const key = header.key.toLowerCase();
      if (key === 'x-api-key'
        || (key === 'authorization' && /^(?:bearer|basic)\s+/i.test(header.value))) {
        header.value = PLACEHOLDERS.redacted;
      }
    }

    switch (copy.auth.type) {
      case 'none':
        return copy;
      case 'bearer':
        this.injectPlaceholder(copy.headers, 'Authorization', `Bearer ${PLACEHOLDERS.bearer}`);
        return copy;
      case 'basic':
        this.injectPlaceholder(copy.headers, 'Authorization', `Basic ${PLACEHOLDERS.basic}`);
        return copy;
      case 'apiKey':
        this.injectPlaceholder(
          copy.auth.in === 'header' ? copy.headers : copy.queryParams,
          copy.auth.name,
          PLACEHOLDERS.apiKey
        );
        return copy;
    }
  }

  prepareForImport(request: JustRequest): PersistedJustRequest {
    const copy = cloneRequest(request);
    if (copy.auth.type === 'bearer' || copy.auth.type === 'basic') {
      copy.headers = copy.headers.filter(
        pair => !(pair.enabled && pair.key.toLowerCase() === 'authorization')
      );
    } else if (copy.auth.type === 'apiKey') {
      const { name, in: location } = copy.auth;
      const pairs = location === 'header' ? copy.headers : copy.queryParams;
      const filtered = pairs.filter(
        pair => !(pair.enabled && pair.key.toLowerCase() === name.toLowerCase())
      );
      if (location === 'header') {
        copy.headers = filtered;
      } else {
        copy.queryParams = filtered;
      }
    }
    return { ...copy, auth: { type: 'none' } };
  }

  async confirmDisclosure(
    destination: string,
    confirm: (disclosure: CredentialDisclosure) => Promise<boolean>
  ): Promise<boolean> {
    if (destination.trim().length === 0) {
      throw new AuthServiceError('AUTH_INVALID');
    }
    return confirm({
      destination,
      warning: `Include authentication credentials in this ${destination}? The generated content may expose secrets.`,
    });
  }

  async migrateLegacyRequests(
    requests: readonly PersistedJustRequest[],
    persist: (requests: PersistedJustRequest[]) => Promise<void>
  ): Promise<number> {
    const next = requests.map(cloneRequest);
    const createdRefs: string[] = [];
    let migrated = 0;

    try {
      for (const request of next) {
        if (request.auth.type !== 'none') {
          continue;
        }
        const match = this.findLegacyAuth(request);
        if (!match) {
          continue;
        }
        const ref = this.createSecretRef(request.id);
        await this.secrets.store(ref, JSON.stringify(this.secretFromInput(match.input)));
        createdRefs.push(ref);
        request.auth = this.persistedConfig(match.input, ref);
        request.headers.splice(match.headerIndex, 1);
        request.updated = Date.now();
        migrated += 1;
      }
      if (migrated > 0) {
        await persist(next);
      }
      return migrated;
    } catch (error) {
      await Promise.all(createdRefs.map(ref => this.secrets.delete(ref)));
      throw error;
    }
  }

  async duplicateRequest(request: PersistedJustRequest, newRequestId: string): Promise<PersistedJustRequest> {
    const copy = cloneRequest(request);
    copy.id = newRequestId;
    copy.created = Date.now();
    copy.updated = copy.created;
    if (request.auth.type === 'none') {
      return copy;
    }
    const serialized = await this.secrets.get(request.auth.secretRef);
    if (!serialized) {
      throw new AuthServiceError('AUTH_SECRET_NOT_FOUND');
    }
    const ref = this.createSecretRef(newRequestId);
    await this.secrets.store(ref, serialized);
    copy.auth = { ...request.auth, secretRef: ref };
    return copy;
  }

  async cleanupRemovedRequests(
    removed: readonly PersistedJustRequest[],
    remaining: readonly PersistedJustRequest[]
  ): Promise<void> {
    const refs = new Set(removed.map(request => secretRefOf(request.auth)).filter(Boolean) as string[]);
    await Promise.all(Array.from(refs, ref => this.deleteIfUnreferenced(ref, remaining)));
  }

  async dispose(): Promise<void> {
    const refs = Array.from(this.staged.values())
      .map(stage => stage.newSecretRef)
      .filter(Boolean) as string[];
    this.staged.clear();
    await Promise.all(refs.map(ref => this.secrets.delete(ref)));
  }

  private resolveConfig(request: JustRequest, existing?: PersistedJustRequest): PersistedAuthConfig {
    const staged = this.staged.get(request.id)?.config;
    if (request.auth.type === 'none') {
      return { type: 'none' };
    }
    if (staged && publicAuthMatches(staged, request.auth)) {
      return staged;
    }
    if (existing && publicAuthMatches(existing.auth, request.auth)) {
      return existing.auth;
    }
    throw new AuthServiceError('AUTH_SECRET_NOT_FOUND');
  }

  private async readSecret(config: Exclude<PersistedAuthConfig, { type: 'none' }>): Promise<StoredSecret> {
    const serialized = await this.secrets.get(config.secretRef);
    if (!serialized) {
      throw new AuthServiceError('AUTH_SECRET_NOT_FOUND');
    }
    try {
      const value = JSON.parse(serialized) as StoredSecret;
      if (value.type !== config.type
        || (value.type === 'bearer' && typeof value.token !== 'string')
        || (value.type === 'basic'
          && (typeof value.username !== 'string' || typeof value.password !== 'string'))
        || (value.type === 'apiKey' && typeof value.value !== 'string')) {
        throw new Error('invalid secret payload');
      }
      return value;
    } catch {
      throw new AuthServiceError('AUTH_SECRET_NOT_FOUND');
    }
  }

  private injectCredential(
    request: JustRequest,
    config: Exclude<PersistedAuthConfig, { type: 'none' }>,
    secret: StoredSecret
  ): JustRequest {
    const copy = cloneRequest(request);
    if (config.type === 'bearer' && secret.type === 'bearer') {
      this.injectTransportValue(copy.headers, 'Authorization', `Bearer ${secret.token}`);
    } else if (config.type === 'basic' && secret.type === 'basic') {
      const encoded = Buffer.from(`${secret.username}:${secret.password}`, 'utf8').toString('base64');
      this.injectTransportValue(copy.headers, 'Authorization', `Basic ${encoded}`);
    } else if (config.type === 'apiKey' && secret.type === 'apiKey') {
      this.injectTransportValue(
        config.in === 'header' ? copy.headers : copy.queryParams,
        config.name,
        secret.value
      );
    } else {
      throw new AuthServiceError('AUTH_SECRET_NOT_FOUND');
    }
    return copy;
  }

  private injectTransportValue(
    pairs: JustRequest['headers'],
    key: string,
    value: string
  ): void {
    if (pairs.some(pair => pair.enabled && pair.key.toLowerCase() === key.toLowerCase())) {
      throw new AuthServiceError('AUTH_CONFLICT');
    }
    pairs.push({ id: `auth-${randomUUID()}`, key, value, enabled: true });
  }

  private injectPlaceholder(pairs: JustRequest['headers'], key: string, value: string): void {
    const conflict = pairs.find(pair => pair.enabled && pair.key.toLowerCase() === key.toLowerCase());
    if (conflict) {
      conflict.value = PLACEHOLDERS.conflict;
      return;
    }
    pairs.push({ id: `auth-placeholder-${randomUUID()}`, key, value, enabled: true });
  }

  private async deleteIfUnreferenced(
    ref: string,
    persistedRequests: readonly PersistedJustRequest[]
  ): Promise<void> {
    if (!persistedRequests.some(request => secretRefOf(request.auth) === ref)) {
      await this.secrets.delete(ref);
    }
  }

  private validateInput(input: AuthInput): void {
    if (input.type === 'bearer' && input.token.length === 0) {
      throw new AuthServiceError('AUTH_INVALID');
    }
    if (input.type === 'apiKey' && (input.name.length === 0 || input.value.length === 0)) {
      throw new AuthServiceError('AUTH_INVALID');
    }
  }

  private secretFromInput(input: Exclude<AuthInput, { type: 'none' }>): StoredSecret {
    switch (input.type) {
      case 'bearer':
        return { type: 'bearer', token: input.token };
      case 'basic':
        return { type: 'basic', username: input.username, password: input.password };
      case 'apiKey':
        return { type: 'apiKey', value: input.value };
    }
  }

  private persistedConfig(
    input: Exclude<AuthInput, { type: 'none' }>,
    secretRef: string
  ): Exclude<PersistedAuthConfig, { type: 'none' }> {
    switch (input.type) {
      case 'bearer':
        return { type: 'bearer', secretRef };
      case 'basic':
        return { type: 'basic', secretRef };
      case 'apiKey':
        return { type: 'apiKey', name: input.name, in: input.in, secretRef };
    }
  }

  private createSecretRef(requestId: string): string {
    return `${SECRET_PREFIX}.${requestId}.${randomUUID()}`;
  }

  private findLegacyAuth(request: PersistedJustRequest): LegacyAuthMatch | undefined {
    const matches: LegacyAuthMatch[] = [];
    request.headers.forEach((header, headerIndex) => {
      if (!header.enabled || header.value.length === 0) {
        return;
      }
      const key = header.key.toLowerCase();
      const bearer = /^Bearer\s+(.+)$/i.exec(header.value);
      if (key === 'authorization' && bearer?.[1]) {
        matches.push({ headerIndex, input: { type: 'bearer', token: bearer[1] } });
        return;
      }
      const basic = /^Basic\s+([^\s]+)$/i.exec(header.value);
      if (key === 'authorization' && basic?.[1]) {
        const credentials = this.decodeBasic(basic[1]);
        if (credentials) {
          matches.push({ headerIndex, input: { type: 'basic', ...credentials } });
        }
        return;
      }
      if (key === 'x-api-key') {
        matches.push({
          headerIndex,
          input: { type: 'apiKey', name: header.key, in: 'header', value: header.value },
        });
      }
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  private decodeBasic(encoded: string): { username: string; password: string } | undefined {
    try {
      const bytes = Buffer.from(encoded, 'base64');
      const canonical = bytes.toString('base64').replace(/=+$/, '');
      if (canonical !== encoded.replace(/=+$/, '')) {
        return undefined;
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const colon = decoded.indexOf(':');
      if (colon < 0) {
        return undefined;
      }
      return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
    } catch {
      return undefined;
    }
  }
}
