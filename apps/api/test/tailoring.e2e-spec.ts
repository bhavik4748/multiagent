import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { TailoringAgentsService } from '../src/tailoring-agents.service';

describe('Phase 2 tailoring API (e2e)', () => {
  let app: INestApplication<App>;
  let analyzedJobDescriptions: string[];

  beforeEach(async () => {
    analyzedJobDescriptions = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TailoringAgentsService)
      .useValue({
        analyzeJob: jest.fn(async (jobDescription: string) => {
          analyzedJobDescriptions.push(jobDescription);
          return {
            targetRole: 'Backend Engineer',
            seniority: 'Senior',
            requirements: [
              {
                id: 'requirement-typescript',
                text: 'TypeScript API development',
                priority: 'high',
                category: 'required',
              },
              {
                id: 'requirement-kubernetes',
                text: 'Kubernetes production experience',
                priority: 'medium',
                category: 'required',
              },
            ],
            keywords: ['TypeScript', 'Kubernetes'],
            ambiguities: [],
          };
        }),
        matchEvidence: jest.fn(
          async (profile: {
            claims: { id: string; evidence: unknown[] }[];
          }) => ({
            rows: [
              {
                requirementId: 'requirement-typescript',
                requirement: 'TypeScript API development',
                strength: 'strong',
                action: 'emphasize',
                evidence: profile.claims[0].evidence,
              },
              {
                requirementId: 'requirement-kubernetes',
                requirement: 'Kubernetes production experience',
                strength: 'none',
                action: 'flag-gap',
                evidence: [],
              },
            ],
          }),
        ),
        draftResume: jest.fn(
          async (profile: {
            resumeId: string;
            claims: {
              id: string;
              text: string;
              section: string;
              evidence: unknown[];
            }[];
          }) => ({
            resumeId: profile.resumeId,
            summary: 'Evidence-grounded TypeScript API engineer.',
            markdown: '## Summary\nEvidence-grounded TypeScript API engineer.',
            claims: [{ ...profile.claims[0], id: 'draft-001' }],
          }),
        ),
        reviewAts: jest.fn(async () => ({
          reviewer: 'ats',
          findings: [
            {
              id: 'ats-001',
              reviewer: 'ats',
              severity: 'medium',
              message: 'Use a standard Experience heading.',
              recommendation: 'Keep the conventional Experience heading.',
              affectedClaimIds: ['draft-001'],
            },
          ],
        })),
        reviewReadability: jest.fn(async () => ({
          reviewer: 'readability',
          findings: [
            {
              id: 'readability-001',
              reviewer: 'readability',
              severity: 'low',
              message: 'The summary can be more direct.',
              recommendation: 'Lead with TypeScript API experience.',
              affectedClaimIds: ['draft-001'],
            },
          ],
        })),
        editFinalResume: jest.fn(
          async (
            profile: {
              resumeId: string;
              claims: {
                id: string;
                text: string;
                section: string;
                evidence: unknown[];
              }[];
            },
            _draft: unknown,
            _jobProfile: unknown,
            _matrix: unknown,
            _atsReview: unknown,
            _readabilityReview: unknown,
            gaps: string[],
          ) => ({
            resumeId: profile.resumeId,
            summary: 'Evidence-grounded TypeScript API engineer.',
            markdown: '## Summary\nEvidence-grounded TypeScript API engineer.',
            claims: [{ ...profile.claims[0], id: 'final-001' }],
            unresolvedGaps: gaps,
            decisions: [
              {
                findingId: 'ats-001',
                decision: 'accepted',
                rationale: 'Uses standard ATS-safe headings.',
                affectedClaimIds: ['final-001'],
              },
              {
                findingId: 'readability-001',
                decision: 'accepted',
                rationale: 'Leads with supported API experience.',
                affectedClaimIds: ['final-001'],
              },
            ],
            changeLog: ['Retained standard headings and concise summary.'],
          }),
        ),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    const openApiConfig = new DocumentBuilder()
      .setTitle('Resume Tweak API')
      .setVersion('0.0.1')
      .build();
    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/openapi.json',
    });
    await app.init();
  });

  async function uploadAndApprove() {
    const fixture = await readFile(
      resolve(__dirname, '../../../data/fixtures/anonymized-resume.docx'),
    );
    const upload = await request(app.getHttpServer())
      .post('/api/resumes/upload')
      .attach('file', fixture, {
        filename: 'anonymized-resume.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .expect(201);
    const approval = await request(app.getHttpServer())
      .post(`/api/resumes/${upload.body.resumeId}/approve`)
      .send({
        claims: upload.body.claims.map(
          (claim: { id: string; text: string }) => ({
            id: claim.id,
            text: claim.text,
          }),
        ),
      })
      .expect(201);
    return { upload, approval };
  }

  it('rejects a tailoring run until the factual profile is approved', async () => {
    const fixture = await readFile(
      resolve(__dirname, '../../../data/fixtures/anonymized-resume.docx'),
    );
    const upload = await request(app.getHttpServer())
      .post('/api/resumes/upload')
      .attach('file', fixture, 'anonymized-resume.docx')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/resumes/${upload.body.resumeId}/tailoring-runs`)
      .send({
        jobDescription:
          'Senior TypeScript API engineer responsible for platform services.',
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe(
          'Tailoring requires an approved factual profile.',
        );
      });
  });

  it('creates an evidence-grounded run, preserves gaps, and persists it for retrieval', async () => {
    const { approval } = await uploadAndApprove();
    const jobDescription =
      'Senior TypeScript API engineer responsible for platform services and Kubernetes operations.';
    const run = await request(app.getHttpServer())
      .post(`/api/resumes/${approval.body.resumeId}/tailoring-runs`)
      .send({
        jobDescription,
        additionalInstructions:
          'Prioritize API experience and keep it concise.',
      })
      .expect(201);

    expect(run.body).toMatchObject({
      status: 'completed',
      resumeId: approval.body.resumeId,
      modelProfileId: 'default',
      deployment: 'gpt-5.6-terra',
      gaps: ['Kubernetes production experience'],
      reviewStatus: 'completed',
      approvalStatus: 'pending',
    });
    expect(run.body.tailoredDraft.claims[0].evidence).toEqual(
      approval.body.claims[0].evidence,
    );
    expect(run.body.evidenceMatrix.rows[1]).toMatchObject({
      strength: 'none',
      action: 'flag-gap',
      evidence: [],
    });

    const retrieved = await request(app.getHttpServer())
      .get(`/api/tailoring-runs/${run.body.runId}`)
      .expect(200);
    expect(retrieved.body).toMatchObject({
      runId: run.body.runId,
      status: 'completed',
    });
    expect(analyzedJobDescriptions).toEqual([jobDescription]);

    const approved = await request(app.getHttpServer())
      .post(`/api/tailoring-runs/${run.body.runId}/approve`)
      .send({ approvalNote: 'Content reviewed.' })
      .expect(201);
    expect(approved.body).toMatchObject({
      approvalStatus: 'approved',
      approvalNote: 'Content reviewed.',
    });
  });

  it('creates a separate run when the user revises the job description', async () => {
    const { approval } = await uploadAndApprove();
    const first = await request(app.getHttpServer())
      .post(`/api/resumes/${approval.body.resumeId}/tailoring-runs`)
      .send({
        jobDescription:
          'Senior TypeScript API engineer building platform services.',
      })
      .expect(201);
    const revisedDescription =
      'Senior TypeScript API engineer building developer platform services.';
    const second = await request(app.getHttpServer())
      .post(`/api/resumes/${approval.body.resumeId}/tailoring-runs`)
      .send({ jobDescription: revisedDescription })
      .expect(201);

    expect(second.body.runId).not.toBe(first.body.runId);
    expect(analyzedJobDescriptions).toEqual([
      'Senior TypeScript API engineer building platform services.',
      revisedDescription,
    ]);
  });

  it('publishes the tailoring endpoints in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/openapi.json')
      .expect(200);
    expect(
      response.body.paths['/api/resumes/{resumeId}/tailoring-runs'],
    ).toBeDefined();
    expect(response.body.paths['/api/tailoring-runs/{runId}']).toBeDefined();
    expect(
      response.body.paths['/api/tailoring-runs/{runId}/approve'],
    ).toBeDefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
