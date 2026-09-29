import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  answerCounts,
  answerWithinLimit,
  isApplicationAnswerDraft,
} from '@resume-tweak/contracts';
import type {
  ApplicationAnswerDraft,
  CanonicalResumeProfile,
} from '@resume-tweak/contracts';
import { ApplicationAnswersService } from './application-answers.service';
import { ApplicationAnswersAgentService } from './application-answers-agent.service';
import { ResumeIngestionService } from './resume-ingestion.service';
import { ModelConfigService } from './model-config.service';

describe('Application answers', () => {
  const profile: CanonicalResumeProfile = {
    resumeId: 'resume-test',
    status: 'approved',
    sourceSegments: [],
    claims: [
      {
        id: 'fact-1',
        text: 'Built TypeScript APIs.',
        section: 'experience',
        evidence: [{ sourceFactId: 'fact-1', sourceSegmentId: 'segment-1' }],
      },
    ],
  };
  const draft = (): ApplicationAnswerDraft => ({
    questionId: 'q1',
    status: 'answered',
    missingInformation: [],
    statements: [
      {
        id: 's1',
        text: 'I built TypeScript APIs.',
        evidence: [
          {
            sourceFactId: 'fact-1',
            sourceSegmentId: 'segment-1',
            quote: 'Built TypeScript APIs.',
          },
        ],
        noteReferences: [],
      },
    ],
  });
  let service: ApplicationAnswersService;
  const resumes = { getProfile: jest.fn() };
  const agents = { draft: jest.fn(), review: jest.fn() };
  const oldEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
  const oldKey = process.env.FOUNDRY_API_KEY;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://example.invalid';
    process.env.FOUNDRY_API_KEY = 'test-only';
    resumes.getProfile.mockResolvedValue(profile);
    agents.draft.mockResolvedValue(draft());
    agents.review.mockResolvedValue({
      statements: [{ statementId: 's1', supported: true }],
      conflicts: [],
      missingInformation: [],
    });
    service = new ApplicationAnswersService(
      resumes as unknown as ResumeIngestionService,
      agents as unknown as ApplicationAnswersAgentService,
      new ModelConfigService(),
    );
  });
  afterAll(() => {
    if (oldEndpoint === undefined) delete process.env.FOUNDRY_PROJECT_ENDPOINT;
    else process.env.FOUNDRY_PROJECT_ENDPOINT = oldEndpoint;
    if (oldKey === undefined) delete process.env.FOUNDRY_API_KEY;
    else process.env.FOUNDRY_API_KEY = oldKey;
  });
  const request = () => ({
    questions: [{ id: 'q1', question: 'Describe your experience.' }],
  });
  it('returns only text assembled from reviewed statements', async () => {
    const result = await service.create(profile.resumeId, request());
    expect(result.answers[0]).toMatchObject({
      status: 'answered',
      answerText: 'I built TypeScript APIs.',
    });
    expect(agents.review).toHaveBeenCalledTimes(1);
  });
  it('requires an approved profile before model access', async () => {
    resumes.getProfile.mockResolvedValue({ ...profile, status: 'draft' });
    await expect(
      service.create(profile.resumeId, request()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(agents.draft).not.toHaveBeenCalled();
  });
  it('preserves missing-source errors', async () => {
    resumes.getProfile.mockRejectedValue(new NotFoundException());
    await expect(service.create('missing', request())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('checks credentials before model calls', async () => {
    delete process.env.FOUNDRY_API_KEY;
    await expect(service.create(profile.resumeId, request())).rejects.toThrow(
      'configured server-side',
    );
    expect(agents.draft).not.toHaveBeenCalled();
  });
  it.each(['fact', 'segment', 'quote', 'uncited', 'identity', 'duplicate'])(
    'withholds invalid %s evidence',
    async (kind) => {
      const value = draft();
      if (kind === 'fact')
        value.statements[0].evidence[0].sourceFactId = 'invented';
      if (kind === 'segment')
        value.statements[0].evidence[0].sourceSegmentId = 'invented';
      if (kind === 'quote')
        value.statements[0].evidence[0].quote = 'Led a 20-person team';
      if (kind === 'uncited') value.statements[0].evidence = [];
      if (kind === 'identity') value.questionId = 'other';
      if (kind === 'duplicate') value.statements.push(value.statements[0]);
      agents.draft.mockResolvedValue(value);
      const result = await service.create(profile.resumeId, request());
      expect(result.answers[0]).toMatchObject({
        status: 'failed',
        answerText: '',
        statements: [],
      });
      expect(agents.review).not.toHaveBeenCalled();
    },
  );
  it('withholds unsupported prose even when citations are valid', async () => {
    agents.review.mockResolvedValue({
      statements: [{ statementId: 's1', supported: false }],
      conflicts: [],
      missingInformation: [],
    });
    expect(
      (await service.create(profile.resumeId, request())).answers[0].status,
    ).toBe('failed');
  });
  it('requires complete support review coverage', async () => {
    agents.review.mockResolvedValue({
      statements: [],
      conflicts: [],
      missingInformation: [],
    });
    expect(
      (await service.create(profile.resumeId, request())).answers[0].status,
    ).toBe('failed');
  });
  it('accepts explicit notes only from the current question', async () => {
    const value = draft();
    value.statements[0] = {
      id: 's1',
      text: 'I profiled the API.',
      evidence: [],
      noteReferences: [{ questionId: 'q1', quote: 'I profiled the API.' }],
    };
    agents.draft.mockResolvedValue(value);
    const input = {
      questions: [
        { ...request().questions[0], factualNotes: 'I profiled the API.' },
      ],
    };
    expect(
      (await service.create(profile.resumeId, input)).answers[0].status,
    ).toBe('answered');
    value.statements[0].noteReferences[0].questionId = 'q2';
    expect(
      (await service.create(profile.resumeId, input)).answers[0].status,
    ).toBe('failed');
  });
  it('returns clarification instead of reconciling conflicting facts', async () => {
    agents.review.mockResolvedValue({
      statements: [{ statementId: 's1', supported: true }],
      conflicts: ['Which project did you own?'],
      missingInformation: [],
    });
    expect(
      (await service.create(profile.resumeId, request())).answers[0],
    ).toMatchObject({
      status: 'needs-user-input',
      answerText: '',
      statements: [],
      missingInformation: ['Which project did you own?'],
    });
  });
  it('shows behavioral gaps outside the partial answer', async () => {
    agents.review.mockResolvedValue({
      statements: [{ statementId: 's1', supported: true }],
      conflicts: [],
      missingInformation: [
        'How did you approach the problem?',
        'What was the outcome?',
      ],
    });
    expect(
      (await service.create(profile.resumeId, request())).answers[0],
    ).toMatchObject({
      status: 'partial',
      answerText: 'I built TypeScript APIs.',
      missingInformation: [
        'How did you approach the problem?',
        'What was the outcome?',
      ],
    });
  });
  it('allows unanswered questions without inventing personal details', async () => {
    agents.draft.mockResolvedValue({
      questionId: 'q1',
      status: 'needs-user-input',
      statements: [],
      missingInformation: ['What is your work authorization?'],
    });
    agents.review.mockResolvedValue({
      statements: [],
      conflicts: [],
      missingInformation: [],
    });
    expect(
      (await service.create(profile.resumeId, request())).answers[0],
    ).toMatchObject({ status: 'needs-user-input', answerText: '' });
  });
  it('rejects over-limit answers without truncating them', async () => {
    const result = await service.create(profile.resumeId, {
      questions: [
        { ...request().questions[0], limit: { unit: 'words', value: 1 } },
      ],
    });
    expect(result.answers[0]).toMatchObject({
      status: 'failed',
      answerText: '',
    });
  });
  it('rejects word limits above the ceiling', async () => {
    await expect(
      service.create(profile.resumeId, {
        questions: [
          { ...request().questions[0], limit: { unit: 'words', value: 501 } },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('isolates provider failures and does not expose raw errors', async () => {
    agents.draft
      .mockRejectedValueOnce(new Error('secret provider details'))
      .mockResolvedValueOnce({ ...draft(), questionId: 'q2' });
    const result = await service.create(profile.resumeId, {
      questions: [
        ...request().questions,
        { id: 'q2', question: 'Another question' },
      ],
    });
    expect(result.answers.map((answer) => answer.status)).toEqual([
      'failed',
      'answered',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret provider details');
  });
  it('rejects malformed model output', async () => {
    agents.draft.mockResolvedValue({ answer: 'Not the contract' });
    expect(
      (await service.create(profile.resumeId, request())).answers[0].status,
    ).toBe('failed');
    expect(isApplicationAnswerDraft(null)).toBe(false);
  });
  it('uses Unicode code points and whitespace word boundaries', () => {
    expect(answerCounts('Hi 😀\nthere')).toEqual({ words: 3, characters: 10 });
    expect(answerWithinLimit('😀', { unit: 'characters', value: 1 })).toBe(
      true,
    );
    expect(answerWithinLimit('x'.repeat(3001))).toBe(false);
    expect(answerWithinLimit('a '.repeat(501))).toBe(false);
  });
});
