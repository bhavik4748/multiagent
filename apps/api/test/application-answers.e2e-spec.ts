import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ApplicationAnswersResponse } from '@resume-tweak/contracts';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApplicationAnswersController } from '../src/application-answers.controller';
import { ApplicationAnswersService } from '../src/application-answers.service';
import { ApplicationAnswersAgentService } from '../src/application-answers-agent.service';
import { ResumeIngestionService } from '../src/resume-ingestion.service';
import { ModelConfigService } from '../src/model-config.service';

describe('Application question endpoint', () => {
  let app: INestApplication<App>;
  const draft = jest.fn<Promise<unknown>, [unknown, { id: string }]>();
  const oldKey = process.env.FOUNDRY_API_KEY;
  const oldEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
  beforeAll(async () => {
    process.env.FOUNDRY_API_KEY = 'test';
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://example.invalid';
    const module = await Test.createTestingModule({
      controllers: [ApplicationAnswersController],
      providers: [
        ApplicationAnswersService,
        ModelConfigService,
        {
          provide: ResumeIngestionService,
          useValue: {
            getProfile: jest.fn((id: string) => {
              if (id === 'missing') throw new NotFoundException();
              return Promise.resolve({
                resumeId: id,
                status: id === 'draft' ? 'draft' : 'approved',
                claims: [],
                sourceSegments: [],
              });
            }),
          },
        },
        {
          provide: ApplicationAnswersAgentService,
          useValue: {
            draft,
            review: jest.fn().mockResolvedValue({
              statements: [],
              conflicts: [],
              missingInformation: [],
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    draft.mockReset();
    draft.mockImplementation((_profile: unknown, question: { id: string }) =>
      Promise.resolve({
        questionId: question.id,
        status: 'needs-user-input',
        statements: [],
        missingInformation: ['Please add the outcome.'],
      }),
    );
  });
  afterAll(async () => {
    await app.close();
    if (oldKey === undefined) delete process.env.FOUNDRY_API_KEY;
    else process.env.FOUNDRY_API_KEY = oldKey;
    if (oldEndpoint === undefined) delete process.env.FOUNDRY_PROJECT_ENDPOINT;
    else process.env.FOUNDRY_PROJECT_ENDPOINT = oldEndpoint;
  });
  const endpoint = '/api/resumes/approved/application-answers';
  it('validates, trims and returns uncached transient answers', async () => {
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .send({
        questions: [
          { id: ' q1 ', question: ' Ownership? ', factualNotes: '  ' },
        ],
      })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (response.body as ApplicationAnswersResponse).answers[0],
    ).toMatchObject({
      questionId: 'q1',
      status: 'needs-user-input',
      answerText: '',
    });
    expect(draft.mock.calls[0][1]).toMatchObject({
      id: 'q1',
      question: 'Ownership?',
      factualNotes: '',
    });
  });
  it.each([
    {},
    { questions: [] },
    { questions: [{ id: 'q', question: '   ' }] },
    { questions: [{ id: 'q', question: 'x'.repeat(2001) }] },
    { questions: [{ id: 'q', question: 'Q', factualNotes: 'x'.repeat(4001) }] },
    { questions: [{ id: 'q', question: 'Q', claims: [] }] },
    {
      questions: [
        { id: 'q', question: 'Q', limit: { unit: 'words', value: 501 } },
      ],
    },
    {
      questions: [
        { id: 'q', question: 'Q', limit: { unit: 'characters', value: 3001 } },
      ],
    },
    {
      questions: [
        { id: 'q', question: 'Q', limit: { unit: 'words', value: 0 } },
      ],
    },
    {
      questions: [
        { id: 'q', question: 'Q', limit: { unit: 'words', value: 1.5 } },
      ],
    },
    {
      questions: [
        { id: 'q', question: 'Q', limit: { unit: 'lines', value: 5 } },
      ],
    },
    { questions: [{ id: 'q', question: 'Q', limit: [] }] },
    {
      questions: [
        { id: 'q', question: 'Q' },
        { id: ' q ', question: 'Other' },
      ],
    },
    {
      questions: Array.from({ length: 6 }, (_, i) => ({
        id: String(i),
        question: 'Q',
      })),
    },
    { questions: [null] },
    { questions: ['not an object'] },
    {
      questions: [{ id: 'q', question: 'Q' }],
      jobDescription: 'x'.repeat(20001),
    },
    { questions: [{ id: 'q', question: 'Q' }], profile: {} },
  ])('rejects invalid request %# before generation', async (body) => {
    await request(app.getHttpServer()).post(endpoint).send(body).expect(400);
    expect(draft).not.toHaveBeenCalled();
  });
  it('requires an existing approved source', async () => {
    const body = { questions: [{ id: 'q1', question: 'Q' }] };
    await request(app.getHttpServer())
      .post('/api/resumes/draft/application-answers')
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/resumes/missing/application-answers')
      .send(body)
      .expect(404);
    expect(draft).not.toHaveBeenCalled();
  });
  it('documents nested question inputs', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(
      document.paths['/api/resumes/{resumeId}/application-answers'].post,
    ).toBeDefined();
    expect(document.components?.schemas?.ApplicationQuestionDto).toBeDefined();
  });
});
