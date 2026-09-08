import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModelConfigService } from './model-config.service';

@ApiTags('system')
@Controller('api')
export class HealthController {
    constructor(private readonly modelConfig: ModelConfigService) { }

    @Get('health')
    @ApiOperation({ summary: 'Report API readiness without exposing secrets.' })
    @ApiOkResponse({
        schema: {
            example: {
                status: 'ok',
                service: 'resume-tweak-api',
                modelProfileId: 'default',
                deployment: 'gpt-5.6-terra',
            },
        },
    })
    getHealth() {
        const profile = this.modelConfig.getActiveProfile();

        return {
            status: 'ok',
            service: 'resume-tweak-api',
            modelProfileId: profile.id,
            deployment: profile.deployment,
        };
    }
}
