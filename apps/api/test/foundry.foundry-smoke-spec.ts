import { FoundryClientService } from '../src/foundry-client.service';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

describe('Foundry deployment smoke test', () => {
  const enabled = process.env.FOUNDRY_SMOKE_TEST_ENABLED === 'true';

  (enabled ? it : it.skip)(
    'invokes only the centrally configured deployment',
    async () => {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      try {
        const client = module.get(FoundryClientService);
        const result = await client.verifyActiveDeployment();
        expect(result.deployment).toBe('gpt-5.6-terra');
        expect(result.response.trim().toLowerCase()).toContain('ready');
      } finally {
        await module.close();
      }
    },
    120_000,
  );
});
