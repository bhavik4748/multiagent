import {
    buildResumeRenderModel,
    isResumeRenderModel,
    type TailoredResumeClaim,
} from '@resume-tweak/contracts';

describe('ResumeRenderModel projection', () => {
    const evidence = (id: string) => [
        { sourceFactId: `fact-${id}`, sourceSegmentId: `segment-${id}` },
    ];

    function claim(
        id: string,
        text: string,
        section: TailoredResumeClaim['section'],
    ): TailoredResumeClaim {
        return { id, text, section, evidence: evidence(id) };
    }

    it('preserves identity, contact, sections, and evidence references', () => {
        const model = buildResumeRenderModel({
            claims: [
                claim('name', 'JORDAN LEE', 'other'),
                claim('headline', 'Platform Engineer', 'other'),
                claim('contact', 'jordan@example.test | linkedin.com/in/jordanlee', 'contact'),
                claim('summary-heading', 'Professional Summary', 'summary'),
                claim('summary', 'Builds reliable TypeScript services.', 'summary'),
                claim('skills-heading', 'Technical Skills', 'skills'),
                claim('skills', 'TypeScript, NestJS, Azure', 'skills'),
                claim('role', 'Platform Engineer | Northwind Systems | 2022 - Present', 'experience'),
                claim('achievement', 'Built TypeScript APIs and deployment workflows.', 'experience'),
                claim('education-heading', 'Education', 'education'),
                claim('education', 'B.S. Computer Science', 'education'),
            ],
        });

        expect(isResumeRenderModel(model)).toBe(true);
        expect(model.identity.name?.text).toBe('JORDAN LEE');
        expect(model.identity.headline?.text).toBe('Platform Engineer');
        expect(model.identity.contactLines[0].text).toContain('jordan@example.test');
        expect(model.summary.map((item) => item.text)).toEqual([
            'Builds reliable TypeScript services.',
        ]);
        expect(model.skills[0].text).toBe('TypeScript, NestJS, Azure');
        expect(model.experience).toHaveLength(1);
        expect(model.experience[0].heading?.text).toContain('Northwind Systems');
        expect(model.experience[0].achievements[0].text).toContain('Built TypeScript');
        expect(model.experience[0].achievements[0].evidence).toEqual(evidence('achievement'));
        expect(model.education[0].text).toBe('B.S. Computer Science');
    });

    it('uses a safe single experience group when no role heading is available', () => {
        const model = buildResumeRenderModel({
            claims: [
                claim('first', 'Delivered API improvements.', 'experience'),
                claim('second', 'Automated cloud deployment.', 'experience'),
                claim('other', 'Additional approved fact.', 'other'),
            ],
        });

        expect(model.experience).toHaveLength(1);
        expect(model.experience[0].heading).toBeUndefined();
        expect(model.experience[0].achievements.map((item) => item.id)).toEqual([
            'first',
            'second',
        ]);
        expect(model.additionalInformation.map((item) => item.id)).toEqual(['other']);
    });

    it('rejects render items without evidence', () => {
        expect(
            isResumeRenderModel({
                schemaVersion: '1',
                identity: { contactLines: [] },
                summary: [{ id: 'summary', text: 'Unsupported', evidence: [] }],
                skills: [],
                experience: [],
                education: [],
                certifications: [],
                additionalInformation: [],
            }),
        ).toBe(false);
    });

    it('prefers approved canonical structures over heuristic grouping', () => {
        const model = buildResumeRenderModel(
            {
                claims: [
                    claim('role', 'Platform Engineer | Northwind | 2022 - Present', 'experience'),
                    claim('achievement', 'Built APIs.', 'experience'),
                    claim('skill', 'TypeScript', 'skills'),
                    claim('education', 'B.S. Computer Science', 'education'),
                ],
            },
            {
                identity: { contactFactIds: [] },
                skillGroups: [{ id: 'skills-platform', itemFactIds: ['fact-skill'] }],
                experienceEntries: [
                    {
                        id: 'northwind',
                        headingFactId: 'fact-role',
                        itemFactIds: ['fact-achievement'],
                    },
                ],
                educationEntries: [
                    { id: 'education-1', itemFactIds: ['fact-education'] },
                ],
                certificationFactIds: [],
            },
        );

        expect(model.skills.map((item) => item.text)).toEqual(['TypeScript']);
        expect(model.experience).toEqual([
            expect.objectContaining({
                id: 'northwind',
                heading: expect.objectContaining({ id: 'role' }),
                achievements: [expect.objectContaining({ id: 'achievement' })],
            }),
        ]);
        expect(model.education.map((item) => item.id)).toEqual(['education']);
    });
});
