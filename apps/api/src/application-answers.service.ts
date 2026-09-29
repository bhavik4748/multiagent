import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  answerWithinLimit,
  isApplicationAnswerDraft,
  isAnswerSupportReview,
} from '@resume-tweak/contracts';
import type {
  ApplicationAnswer,
  ApplicationAnswersRequest,
  ApplicationAnswersResponse,
  ApplicationQuestion,
  CanonicalResumeProfile,
} from '@resume-tweak/contracts';
import { ResumeIngestionService } from './resume-ingestion.service';
import { ApplicationAnswersAgentService } from './application-answers-agent.service';
import { ModelConfigService } from './model-config.service';

@Injectable()
export class ApplicationAnswersService {
  constructor(
    private readonly resumes: ResumeIngestionService,
    private readonly agents: ApplicationAnswersAgentService,
    private readonly models: ModelConfigService,
  ) {}

  async create(
    resumeId: string,
    request: ApplicationAnswersRequest,
  ): Promise<ApplicationAnswersResponse> {
    const profile = await this.resumes.getProfile(resumeId);
    if (profile.status !== 'approved')
      throw new BadRequestException(
        'Application answers require an approved factual profile.',
      );
    if (
      request.questions.some(
        (question) =>
          question.limit?.unit === 'words' && question.limit.value > 500,
      )
    ) {
      throw new BadRequestException('Word limits cannot exceed 500.');
    }
    const model = this.models.getActiveProfile();
    if (!process.env.FOUNDRY_PROJECT_ENDPOINT || !process.env.FOUNDRY_API_KEY) {
      throw new ServiceUnavailableException(
        'Foundry endpoint and API key must be configured server-side.',
      );
    }
    const answers: ApplicationAnswer[] = [];
    // Limit concurrent model pipelines; keep request order and isolate failures.
    for (let index = 0; index < request.questions.length; index += 2) {
      answers.push(
        ...(await Promise.all(
          request.questions
            .slice(index, index + 2)
            .map((question) =>
              this.answer(
                profile,
                question,
                request.jobDescription?.trim() || undefined,
              ),
            ),
        )),
      );
    }
    return {
      resumeId,
      modelProfileId: model.id,
      deployment: model.deployment,
      answers,
    };
  }

  private async answer(
    profile: CanonicalResumeProfile,
    question: ApplicationQuestion,
    jobDescription?: string,
  ): Promise<ApplicationAnswer> {
    try {
      const draft = await this.agents.draft(profile, question, jobDescription);
      if (
        !isApplicationAnswerDraft(draft) ||
        draft.questionId !== question.id ||
        new Set(draft.statements.map((s) => s.id)).size !==
          draft.statements.length
      )
        throw new Error('Invalid draft');
      if (draft.status === 'needs-user-input') {
        if (draft.statements.length || !draft.missingInformation.length)
          throw new Error('Invalid empty answer');
      } else if (
        !draft.statements.length ||
        (draft.status === 'partial' && !draft.missingInformation.length) ||
        (draft.status === 'answered' && draft.missingInformation.length)
      ) {
        throw new Error('Inconsistent answer status');
      }
      for (const statement of draft.statements) {
        if (!statement.evidence.length && !statement.noteReferences.length)
          throw new Error('Uncited statement');
        for (const reference of statement.evidence) {
          const claim = profile.claims.find(
            (claim) => claim.id === reference.sourceFactId,
          );
          if (
            !claim ||
            !claim.evidence.some(
              (e) =>
                e.sourceFactId === reference.sourceFactId &&
                e.sourceSegmentId === reference.sourceSegmentId,
            ) ||
            !claim.text.includes(reference.quote)
          )
            throw new Error('Invalid resume evidence');
        }
        for (const reference of statement.noteReferences) {
          if (
            reference.questionId !== question.id ||
            !question.factualNotes?.includes(reference.quote)
          )
            throw new Error('Invalid note evidence');
        }
      }
      const answerText = draft.statements
        .map((statement) => statement.text.trim())
        .join(' ');
      if (!answerWithinLimit(answerText, question.limit))
        throw new Error('Answer exceeds limit');
      const review = await this.agents.review(profile, question, draft);
      if (
        !isAnswerSupportReview(review) ||
        review.statements.length !== draft.statements.length ||
        new Set(review.statements.map((s) => s.statementId)).size !==
          draft.statements.length ||
        review.statements.some(
          (s) =>
            !s.supported ||
            !draft.statements.some((d) => d.id === s.statementId),
        )
      )
        throw new Error('Unsupported answer');
      if (review.conflicts.length) {
        return {
          questionId: question.id,
          status: 'needs-user-input',
          statements: [],
          answerText: '',
          missingInformation: review.conflicts,
        };
      }
      const missingInformation = [
        ...new Set([...draft.missingInformation, ...review.missingInformation]),
      ];
      return {
        ...draft,
        answerText,
        missingInformation,
        status: !answerText
          ? 'needs-user-input'
          : missingInformation.length
            ? 'partial'
            : 'answered',
      };
    } catch {
      // Never expose provider responses, raw prompts, or an unverified draft.
      return {
        questionId: question.id,
        status: 'failed',
        answerText: '',
        statements: [],
        missingInformation: [],
        error:
          'Could not produce a supported answer within the limit. Add factual detail, adjust the limit, or retry.',
      };
    }
  }
}
