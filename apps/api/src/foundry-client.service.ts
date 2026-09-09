import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { ModelConfigService } from './model-config.service';

export function parseStructuredOutput(output: string): unknown {
  const trimmed = output.trim();
  const json =
    trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  return JSON.parse(json);
}

@Injectable()
export class FoundryClientService {
  constructor(private readonly modelConfig: ModelConfigService) {}

  async createStructuredResponse<T>(request: {
    name: string;
    instructions: string;
    input: unknown;
    validate: (value: unknown) => value is T;
    schema: Record<string, unknown>;
  }): Promise<T> {
    const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
    const apiKey = process.env.FOUNDRY_API_KEY;
    if (!endpoint || !apiKey) {
      throw new ServiceUnavailableException(
        'Foundry endpoint and API key must be configured server-side.',
      );
    }
    const profile = this.modelConfig.getActiveProfile();
    const client = new OpenAI({
      baseURL: endpoint.replace(/\/responses\/?$/, '/'),
      apiKey,
    });
    const response = await client.responses.create({
      model: profile.deployment,
      instructions: request.instructions,
      input: JSON.stringify(request.input),
      max_output_tokens: profile.maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: request.name,
          strict: true,
          schema: request.schema,
        },
      },
    });
    try {
      const parsed = parseStructuredOutput(response.output_text);
      if (!request.validate(parsed)) {
        throw new Error('The response did not match the required contract.');
      }
      return parsed;
    } catch {
      throw new ServiceUnavailableException(
        `${request.name} returned invalid structured output.`,
      );
    }
  }

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
