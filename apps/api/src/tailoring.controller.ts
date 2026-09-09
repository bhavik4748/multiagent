import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateTailoringRunDto } from './tailoring.dto';
import { TailoringService } from './tailoring.service';

@ApiTags('tailoring')
@Controller('api')
export class TailoringController {
  constructor(private readonly tailoring: TailoringService) {}

  @Post('resumes/:resumeId/tailoring-runs')
  @ApiOperation({
    summary: 'Create an evidence-grounded Phase 2 tailoring run.',
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
}
