import { parseStructuredOutput } from './foundry-client.service';

describe('parseStructuredOutput', () => {
  it('parses a direct JSON response', () => {
    expect(parseStructuredOutput('{"targetRole":"Engineer"}')).toEqual({
      targetRole: 'Engineer',
    });
  });

  it('parses JSON wrapped in a markdown code fence', () => {
    expect(
      parseStructuredOutput('```json\n{"targetRole":"Engineer"}\n```'),
    ).toEqual({ targetRole: 'Engineer' });
  });

  it('rejects a prose response', () => {
    expect(() =>
      parseStructuredOutput('Here is the requested JSON:'),
    ).toThrow();
  });
});
