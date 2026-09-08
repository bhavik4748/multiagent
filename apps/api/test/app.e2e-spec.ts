import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
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

  afterEach(async () => {
    await app.close();
  });
});
