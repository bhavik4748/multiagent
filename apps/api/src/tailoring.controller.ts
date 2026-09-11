import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApproveTailoringRunDto,
  CreateResumeVersionDto,
  CreateTailoringRunDto,
} from './tailoring.dto';
import { TailoringService } from './tailoring.service';
import { VersionService } from './version.service';
import { ResumeIngestionService } from './resume-ingestion.service';

@ApiTags('tailoring')
@Controller('api')
export class TailoringController {
  constructor(
    private readonly tailoring: TailoringService,
    private readonly versions: VersionService,
    private readonly resumes: ResumeIngestionService,
  ) {}

  @Post('resumes/:resumeId/tailoring-runs')
  @ApiOperation({
    summary:
      'Create an evidence-grounded tailoring run with Phase 3 quality review.',
  })
  @ApiCreatedResponse({
    description: 'The completed or failed locally persisted run.',
    schema: {
      example: {
        runId: 'run-9d9e0d2d-0000-0000-0000-000000000000',
        status: 'completed',
        modelProfileId: 'default',
        deployment: 'gpt-5.6-terra',
        gaps: ['Kubernetes production experience'],
      },
    },
  })
  create(
    @Param('resumeId') resumeId: string,
    @Body() request: CreateTailoringRunDto,
  ) {
    return this.tailoring.createRun(resumeId, request);
  }

  @Get('tailoring-runs/:runId')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'A locally persisted tailoring run.',
    schema: {
      example: {
        runId: 'run-9d9e0d2d-0000-0000-0000-000000000000',
        status: 'completed',
        modelProfileId: 'default',
        deployment: 'gpt-5.6-terra',
        gaps: ['Kubernetes production experience'],
      },
    },
  })
  get(@Param('runId') runId: string) {
    return this.tailoring.getRun(runId);
  }

  @Post('tailoring-runs/:runId/approve')
  @ApiOperation({
    summary:
      'Explicitly approve reviewed final resume content. This does not generate files.',
  })
  @ApiCreatedResponse({
    description: 'The approved locally persisted tailoring run.',
  })
  approve(
    @Param('runId') runId: string,
    @Body() request: ApproveTailoringRunDto,
  ) {
    return this.tailoring.approveRun(runId, request.approvalNote);
  }

  @Post('tailoring-runs/:runId/versions')
  @ApiOperation({
    summary:
      'Generate ATS-safe DOCX/PDF artifacts and save an approved resume version.',
  })
  createVersion(
    @Param('runId') runId: string,
    @Body() request: CreateResumeVersionDto,
  ) {
    return this.tailoring.createVersion(runId, request);
  }

  @Get('resume-versions')
  @ApiOperation({
    summary: 'List locally saved general, targeted, and job-specific versions.',
  })
  listVersions() {
    return this.versions.listVersions();
  }

  @Get('resume-versions/:versionId/source-profile')
  @ApiOperation({
    summary:
      'Return the approved factual profile associated with a saved version.',
  })
  async sourceProfile(@Param('versionId') versionId: string) {
    const resumeId = await this.versions.getSourceResumeId(versionId);
    return this.resumes.getProfile(resumeId);
  }

  @Get('resume-versions/:versionId/download/:format')
  @ApiOperation({
    summary: 'Download a generated ATS-safe DOCX or matching PDF.',
  })
  async download(
    @Param('versionId') versionId: string,
    @Param('format') format: string,
    @Res() response: Response,
  ) {
    if (format !== 'docx' && format !== 'pdf') {
      throw new BadRequestException('Download format must be docx or pdf.');
    }
    const artifact = await this.versions.getArtifact(versionId, format);
    return response.download(artifact.path, artifact.filename);
  }
}
