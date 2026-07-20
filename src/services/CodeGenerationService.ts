import { CodeGenerator } from '../commands/CodeGenerator';
import { AuthService } from '../engine/auth/AuthService';
import { CodeTargetLanguage } from '../models/MessageProtocol';
import { JustRequest } from '../models/Request';
import { ApplicationError } from './ApplicationError';
import { CollectionService } from './CollectionService';
import { RequestPreparation } from './RequestPreparationService';

export interface CodeGenerationResult {
  code: string;
  language: CodeTargetLanguage;
}

export class CodeGenerationService {
  constructor(
    private readonly generator: CodeGenerator,
    private readonly preparation: RequestPreparation,
    private readonly collections: CollectionService,
    private readonly auth: AuthService,
    private readonly confirmDisclosure: (destination: string) => Promise<boolean>
  ) {}

  async generate(
    request: JustRequest,
    language: CodeTargetLanguage,
    collectionId?: string,
    includeCredentials = false
  ): Promise<CodeGenerationResult> {
    const preflight = await this.preparation.resolve(request, collectionId);
    if (!preflight.ok) {
      throw new ApplicationError('VARIABLE_RESOLUTION_FAILED');
    }
    const disclose = includeCredentials
      && await this.confirmDisclosure(`${language} code sample`);
    const prepared = disclose
      ? await this.auth.resolveForTransport(
          preflight.request,
          this.collections.getPersistedRequest(request.id),
          request.auth
        )
      : this.preparation.redactForDerivative(preflight.request);
    return {
      code: this.generator.generate(prepared, language, {
        credentialRepresentation: disclose ? 'resolved' : 'placeholder',
      }),
      language,
    };
  }
}
