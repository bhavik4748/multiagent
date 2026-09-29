import { Body, Controller, Header, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateApplicationAnswersDto } from './application-answers.dto';
import { ApplicationAnswersService } from './application-answers.service';

@ApiTags('Application questions')
@Controller('api/resumes')
export class ApplicationAnswersController {
  constructor(private readonly answers: ApplicationAnswersService) {}

  @Post(':resumeId/application-answers')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Draft transient application answers from an approved resume and optional user facts.',
  })
  create(
    @Param('resumeId') resumeId: string,
    @Body() body: CreateApplicationAnswersDto,
  ) {
    return this.answers.create(resumeId, body);
  }
}
