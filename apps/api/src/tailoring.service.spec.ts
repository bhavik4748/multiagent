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

  it('adds an unresolved decision for a reviewer finding omitted by the final editor', () => {
    const normalized = (
      service as never as {
        normalizeFinalResume: (
          result: unknown,
          ats: unknown,
          readability: unknown,
          gaps: readonly string[],
        ) => {
          decisions: { findingId: string; decision: string }[];
          unresolvedGaps: string[];
        };
      }
    ).normalizeFinalResume(
      {
        resumeId: 'resume-001',
        markdown: 'Draft',
        claims: [
          {
            id: 'draft-001',
            text: 'Built TypeScript APIs.',
            section: 'experience',
            evidence: [
              { sourceFactId: 'fact-0001', sourceSegmentId: 'segment-0001' },
            ],
          },
        ],
        unresolvedGaps: [],
        decisions: [],
        changeLog: [],
      },
      {
        reviewer: 'ats',
        findings: [
          {
            id: 'ats-001',
            reviewer: 'ats',
            severity: 'low',
            message: 'Shorten bullet.',
            recommendation: 'Edit it.',
            affectedClaimIds: ['draft-001'],
          },
        ],
      },
      { reviewer: 'readability', findings: [] },
      ['Kubernetes'],
    );

    expect(normalized.decisions).toEqual([
      expect.objectContaining({ findingId: 'ats-001', decision: 'unresolved' }),
    ]);
    expect(normalized.unresolvedGaps).toContain('Kubernetes');
  });
});
