import { BadRequestException } from '@nestjs/common';
import { TailoringService } from './tailoring.service';

describe('TailoringService evidence guardrails', () => {
  const profile = {
    resumeId: 'resume-001',
    status: 'approved' as const,
    sourceSegments: [{ id: 'segment-0001', text: 'Built APIs.', sequence: 0 }],
    claims: [
      {
        id: 'fact-0001',
        text: 'Built TypeScript APIs.',
        section: 'experience' as const,
        evidence: [
          { sourceFactId: 'fact-0001', sourceSegmentId: 'segment-0001' },
        ],
      },
    ],
  };

  const service = new TailoringService(
    { getProfile: jest.fn() } as never,
    {} as never,
    {} as never,
  );

  it('permits an unmatched requirement only when it is flagged as a gap without evidence', () => {
    expect(() =>
      (
        service as never as {
          validateMatrix: (
            profile: typeof profile,
            ids: string[],
            matrix: unknown,
          ) => void;
        }
      ).validateMatrix(profile, ['required-api'], {
        rows: [
          {
            requirementId: 'required-api',
            requirement: 'Kubernetes',
            strength: 'none',
            action: 'flag-gap',
            evidence: [],
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a fabricated source reference', () => {
    expect(() =>
      (
        service as never as {
          validateMatrix: (
            profile: typeof profile,
            ids: string[],
            matrix: unknown,
          ) => void;
        }
      ).validateMatrix(profile, ['required-api'], {
        rows: [
          {
            requirementId: 'required-api',
            requirement: 'TypeScript',
            strength: 'strong',
            action: 'emphasize',
            evidence: [
              { sourceFactId: 'invented', sourceSegmentId: 'segment-0001' },
            ],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('requires every analyzed requirement to have an evidence-matrix row', () => {
    expect(() =>
      (
        service as never as {
          validateMatrix: (
            profile: typeof profile,
            ids: string[],
            matrix: unknown,
          ) => void;
        }
      ).validateMatrix(profile, ['required-api', 'required-cloud'], {
        rows: [
          {
            requirementId: 'required-api',
            requirement: 'TypeScript',
            strength: 'strong',
            action: 'emphasize',
            evidence: [
              { sourceFactId: 'fact-0001', sourceSegmentId: 'segment-0001' },
            ],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});
