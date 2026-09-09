import {
  Controller,
  Get,
  Param,
  Body,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ResumeIngestionService } from './resume-ingestion.service';

@Controller('api/resumes')
export class ResumeController {
  constructor(
    private readonly resumeIngestionService: ResumeIngestionService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return this.resumeIngestionService.ingestDocx(file);
  }

  @Get(':resumeId/profile')
  getProfile(@Param('resumeId') resumeId: string) {
    return this.resumeIngestionService.getProfile(resumeId);
  }

  @Post(':resumeId/approve')
  approve(
    @Param('resumeId') resumeId: string,
    @Body() body: { claims: { id: string; text: string }[] },
  ) {
    return this.resumeIngestionService.approveProfile(resumeId, body.claims);
  }
}
