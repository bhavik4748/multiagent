import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { ModelConfigService } from './model-config.service';

@Injectable()
export class FoundryClientService {
  constructor(private readonly modelConfig: ModelConfigService) {}

  async verifyActiveDeployment(): Promise<{
    deployment: string;
    response: string;
  }> {
    const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
    const apiKey = process.env.FOUNDRY_API_KEY;

    if (!endpoint || !apiKey) {
      throw new ServiceUnavailableException(
        'Foundry endpoint and API key must be configured server-side.',
      );
    }

    const profile = this.modelConfig.getActiveProfile();
    const baseURL = endpoint.replace(/\/responses\/?$/, '/');
    const client = new OpenAI({
      baseURL,
      apiKey,
    });

    const response = await client.responses.create({
      model: profile.deployment,
      input: 'Reply with the single word: ready',
      max_output_tokens: 16,
    });

    return {
      deployment: profile.deployment,
      response: response.output_text,
    };
  }
}
