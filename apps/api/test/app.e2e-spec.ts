import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from './../src/app.module';

describe('Phase 0 API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  it('/api/health (GET) reports the centrally resolved model profile', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200).expect({
      status: 'ok',
      service: 'resume-tweak-api',
      modelProfileId: 'default',
      deployment: 'gpt-5.6-terra',
    });
  });

  it('/api/openapi.json (GET) publishes the health contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/openapi.json')
      .expect(200);

    expect(response.body.paths['/api/health']).toBeDefined();
  });

  it('uploads, retrieves, and approves a source-backed DOCX profile', async () => {
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

    expect(upload.body.status).toBe('draft');
    expect(upload.body.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: 'contact',
          evidence: [
            expect.objectContaining({ sourceSegmentId: 'segment-0002' }),
          ],
        }),
      ]),
    );

    const retrieved = await request(app.getHttpServer())
      .get(`/api/resumes/${upload.body.resumeId}/profile`)
      .expect(200);
    expect(retrieved.body).toMatchObject({
      resumeId: upload.body.resumeId,
      status: 'draft',
    });

    const approval = await request(app.getHttpServer())
      .post(`/api/resumes/${upload.body.resumeId}/approve`)
      .send({
        claims: upload.body.claims
          .slice(0, 2)
          .map((claim: { id: string; text: string }) => ({
            ...claim,
            text: `${claim.text} (reviewed)`,
          })),
      })
      .expect(201);
    expect(approval.body).toMatchObject({ status: 'approved' });
    expect(approval.body.approvedAt).toEqual(expect.any(String));
    expect(approval.body.claims).toHaveLength(2);
    expect(approval.body.claims[0].evidence).toHaveLength(1);
  });

  it('rejects malformed DOCX uploads', () => {
    return request(app.getHttpServer())
      .post('/api/resumes/upload')
      .attach('file', Buffer.from('not a DOCX'), {
        filename: 'invalid.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe(
          'The uploaded file is not a readable DOCX.',
        );
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
