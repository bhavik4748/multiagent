import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AnswerLimitDto {
  @ApiProperty({ enum: ['words', 'characters'] })
  @IsIn(['words', 'characters'])
  unit!: 'words' | 'characters';

  @ApiProperty({ minimum: 1, maximum: 3000 })
  @IsInt()
  @Min(1)
  @Max(3000)
  value!: number;
}

export class ApplicationQuestionDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  @ApiPropertyOptional({
    maxLength: 4000,
    description:
      'User-provided facts for this question only; not verified resume evidence.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  factualNotes?: string;

  @ApiPropertyOptional({ type: AnswerLimitDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AnswerLimitDto)
  limit?: AnswerLimitDto;
}

export class CreateApplicationAnswersDto {
  @ApiProperty({ type: [ApplicationQuestionDto], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((question: ApplicationQuestionDto) => question?.id)
  @ValidateNested({ each: true })
  @Type(() => ApplicationQuestionDto)
  questions!: ApplicationQuestionDto[];

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20000)
  jobDescription?: string;
}
