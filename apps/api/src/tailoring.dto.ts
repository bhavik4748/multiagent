import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTailoringRunDto {
  @ApiProperty({
    description: 'Pasted job description used only for this tailoring run.',
    minLength: 40,
  })
  @IsString()
  @MinLength(40)
  @MaxLength(20_000)
  jobDescription!: string;

  @ApiPropertyOptional({
    description:
      'Optional emphasis, length, or tone preference. This is never factual evidence.',
    maxLength: 2_000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  additionalInstructions?: string;
}

export class TailoringRunResponseDto {
  @ApiProperty({ example: 'run-9d9e0d2d-0000-0000-0000-000000000000' })
  runId!: string;

  @ApiProperty({ enum: ['completed', 'failed'], example: 'completed' })
  status!: 'completed' | 'failed';

  @ApiProperty({ example: 'default' })
  modelProfileId!: string;

  @ApiProperty({ example: 'gpt-5.6-terra' })
  deployment!: string;

  @ApiProperty({
    type: [String],
    example: ['Kubernetes production experience'],
  })
  gaps!: string[];
}

export class ApproveTailoringRunDto {
  @ApiPropertyOptional({
    description:
      'Optional reviewer note retained with the explicit final-content approval.',
    maxLength: 1_000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  approvalNote?: string;
}
