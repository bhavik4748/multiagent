import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
    DEFAULT_FOUNDRY_DEPLOYMENT,
    MODEL_PROFILE_ID,
    type ModelProfile,
} from '@resume-tweak/contracts';

@Injectable()
export class ModelConfigService {
    getActiveProfile(): ModelProfile {
        const deployment =
            process.env.FOUNDRY_DEFAULT_MODEL_DEPLOYMENT ??
            DEFAULT_FOUNDRY_DEPLOYMENT;
        const apiVersion =
            process.env.FOUNDRY_DEFAULT_MODEL_API_VERSION ?? '2025-01-01-preview';

        if (deployment.trim().length === 0 || apiVersion.trim().length === 0) {
            throw new ServiceUnavailableException(
                'The active Foundry model profile is invalid.',
            );
        }

        return {
            id: MODEL_PROFILE_ID,
            provider: 'microsoft-foundry',
            deployment,
            apiVersion,
            enabled: true,
            allowedFor: ['resume-tailoring'],
            maxOutputTokens: 8000,
        };
    }
}
