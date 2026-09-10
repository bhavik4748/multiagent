import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { FoundryClientService } from './foundry-client.service';
import { ModelConfigService } from './model-config.service';
import { ResumeController } from './resume.controller';
import { ResumeIngestionService } from './resume-ingestion.service';
import { TailoringController } from './tailoring.controller';
import { TailoringService } from './tailoring.service';
import { TailoringAgentsService } from './tailoring-agents.service';
import { DocumentService } from './document.service';
import { VersionService } from './version.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    AppController,
    HealthController,
    ResumeController,
    TailoringController,
  ],
  providers: [
    AppService,
    ModelConfigService,
    FoundryClientService,
    ResumeIngestionService,
    TailoringAgentsService,
    DocumentService,
    VersionService,
    TailoringService,
  ],
})
export class AppModule {}
