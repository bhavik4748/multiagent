import {
    hasUnsupportedClaims,
    type CanonicalResumeProfile,
    type FinalResumePackage,
} from '@resume-tweak/contracts';

describe('evidence guard', () => {
    const source: CanonicalResumeProfile = {
        resumeId: 'resume-001',
        claims: [
            {
                id: 'experience-001-bullet-001',
                text: 'Built TypeScript APIs.',
                evidence: [
                    {
                        sourceFactId: 'experience-001-bullet-001',
                        sourceSegmentId: 'source-paragraph-12',
                    },
                ],
            },
        ],
    };

    it('rejects a material claim without source-backed evidence', () => {
        const output: FinalResumePackage = {
            resumeId: source.resumeId,
            claims: [
                {
                    id: 'draft-001',
                    text: 'Led a cloud migration.',
                    evidence: [],
                },
            ],
        };

        expect(hasUnsupportedClaims(source, output)).toBe(true);
    });

    it('accepts a claim linked to a canonical source fact', () => {
        const output: FinalResumePackage = {
            resumeId: source.resumeId,
            claims: [
                {
                    id: 'draft-001',
                    text: 'Built APIs with TypeScript.',
                    evidence: [
                        {
                            sourceFactId: 'experience-001-bullet-001',
                            sourceSegmentId: 'source-paragraph-12',
                        },
                    ],
                },
            ],
        };

        expect(hasUnsupportedClaims(source, output)).toBe(false);
    });
});
