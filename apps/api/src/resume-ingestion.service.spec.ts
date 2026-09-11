import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResumeIngestionService } from './resume-ingestion.service';

describe('ResumeIngestionService structured extraction', () => {
    let service: ResumeIngestionService;
    let dataRoot: string;

    beforeEach(() => {
        service = new ResumeIngestionService();
        dataRoot = join(tmpdir(), `resume-tweak-ingestion-${randomUUID()}`);
        (service as unknown as { dataRoot: string }).dataRoot = dataRoot;
    });

    afterEach(async () => {
        await rm(dataRoot, { recursive: true, force: true });
    });

    it('carries section headings into following content paragraphs', () => {
        const classifyParagraphs = (
            service as unknown as {
                classifyParagraphs: (
                    paragraphs: string[],
                ) => { text: string; section: string; isHeading: boolean }[];
            }
        ).classifyParagraphs.bind(service);

        expect(
            classifyParagraphs([
                'Jordan Lee',
                'jordan@example.test | linkedin.com/in/jordanlee',
                'Professional Summary',
                'Platform engineer building reliable services.',
                'Technical Skills',
                'TypeScript, NestJS, Azure',
                'Professional Experience',
                'Platform Engineer | Northwind Systems | 2022 - Present',
                'Built TypeScript APIs and deployment workflows.',
                'Education',
                'B.S. Computer Science',
            ]),
        ).toEqual([
            { text: 'Jordan Lee', section: 'other', isHeading: false },
            {
                text: 'jordan@example.test | linkedin.com/in/jordanlee',
                section: 'contact',
                isHeading: false,
            },
            { text: 'Professional Summary', section: 'summary', isHeading: true },
            {
                text: 'Platform engineer building reliable services.',
                section: 'summary',
                isHeading: false,
            },
            { text: 'Technical Skills', section: 'skills', isHeading: true },
            {
                text: 'TypeScript, NestJS, Azure',
                section: 'skills',
                isHeading: false,
            },
            {
                text: 'Professional Experience',
                section: 'experience',
                isHeading: true,
            },
            {
                text: 'Platform Engineer | Northwind Systems | 2022 - Present',
                section: 'experience',
                isHeading: false,
            },
            {
                text: 'Built TypeScript APIs and deployment workflows.',
                section: 'experience',
                isHeading: false,
            },
            { text: 'Education', section: 'education', isHeading: true },
            { text: 'B.S. Computer Science', section: 'education', isHeading: false },
        ]);
    });

    it('persists section metadata alongside claims and source evidence', async () => {
        const persistProfile = (
            service as unknown as {
                persistProfile: (
                    file: Express.Multer.File,
                    paragraphs: string[],
                    sourceExtension: 'docx' | 'pdf',
                ) => Promise<{
                    resumeId: string;
                    claims: { id: string; text: string; section: string }[];
                    sourceSegments: {
                        text: string;
                        section?: string;
                        isHeading?: boolean;
                    }[];
                    structure?: {
                        skillGroups: { itemFactIds: string[] }[];
                    };
                }>;
            }
        ).persistProfile.bind(service);

        const profile = await persistProfile(
            {
                originalname: 'resume.docx',
                mimetype:
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                size: 4,
                buffer: Buffer.from('test'),
            } as Express.Multer.File,
            ['Skills', 'TypeScript and Azure'],
            'docx',
        );

        expect(profile.claims[1]).toMatchObject({
            text: 'TypeScript and Azure',
            section: 'skills',
        });
        expect(profile.sourceSegments[0]).toMatchObject({
            section: 'skills',
            isHeading: true,
        });
        expect(profile.structure).toMatchObject({
            skillGroups: [
                {
                    itemFactIds: [profile.claims[1].id],
                },
            ],
        });
        expect(
            JSON.parse(
                await readFile(
                    join(dataRoot, 'base', profile.resumeId, 'canonical-resume.json'),
                    'utf8',
                ),
            ),
        ).toMatchObject({ resumeId: profile.resumeId });
    });

    it('rebuilds canonical structures after an approved section correction', async () => {
        const persistProfile = (
            service as unknown as {
                persistProfile: (
                    file: Express.Multer.File,
                    paragraphs: string[],
                    sourceExtension: 'docx' | 'pdf',
                ) => Promise<{
                    resumeId: string;
                    claims: { id: string; text: string }[];
                }>;
            }
        ).persistProfile.bind(service);
        const profile = await persistProfile(
            {
                originalname: 'resume.docx',
                mimetype: 'application/octet-stream',
                size: 4,
                buffer: Buffer.from('test'),
            } as Express.Multer.File,
            ['Additional detail'],
            'docx',
        );

        const approved = await service.approveProfile(profile.resumeId, [
            {
                id: profile.claims[0].id,
                text: profile.claims[0].text,
                section: 'skills',
            },
        ]);

        expect(approved.claims[0].section).toBe('skills');
        expect(approved.structure?.skillGroups[0].itemFactIds).toEqual([
            profile.claims[0].id,
        ]);
    });
});
