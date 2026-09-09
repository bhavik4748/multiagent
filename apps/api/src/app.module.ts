import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { FoundryClientService } from './foundry-client.service';
import { ModelConfigService } from './model-config.service';
import { ResumeController } from './resume.controller';
import { ResumeIngestionService } from './resume-ingestion.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, HealthController, ResumeController],
  providers: [
    AppService,
    ModelConfigService,
    FoundryClientService,
    ResumeIngestionService,
  ],
})
export class AppModule {}
