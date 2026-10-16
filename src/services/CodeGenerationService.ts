import { CodeGenerator } from '../commands/CodeGenerator';
import { AuthService } from '../engine/auth/AuthService';
import { CodeTargetLanguage } from '../models/MessageProtocol';
import { JustRequest } from '../models/Request';
import { preflightError } from './ApplicationError';
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
    const preparation = this.preparation.capture?.() ?? this.preparation;
    const preflight = await preparation.resolve(request, collectionId);
    if (!preflight.ok) {
      throw preflightError(preflight.diagnostics);
    }
    const disclose = includeCredentials
      && await this.confirmDisclosure(`${language} code sample`);
    const prepared = disclose
      ? await preparation.resolveForTransport(request, collectionId)
      : preparation.redactForDerivative(preflight.request);
    return {
      code: this.generator.generate(prepared, language, {
        credentialRepresentation: disclose ? 'resolved' : 'placeholder',
      }),
      language,
    };
  }
}
