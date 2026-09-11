import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
    access,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { VersionService } from './version.service';
import type { ResumeVersionMetadata } from '@resume-tweak/contracts';

describe('VersionService Phase A persistence safeguards', () => {
    let root: string;
    let service: VersionService;
    let documents: {
        createArtifacts: jest.Mock;
        hashText: jest.Mock;
    };

    const approvedRun = {
        runId: 'run-001',
        resumeId: 'resume-001',
        status: 'completed' as const,
        createdAt: '2026-09-11T00:00:00.000Z',
        approvalStatus: 'approved' as const,
        approvedAt: '2026-09-11T00:01:00.000Z',
        reviewStatus: 'completed' as const,
        modelProfileId: 'default',
        deployment: 'gpt-5.6-terra',
        gaps: [],
        jobProfile: {
            targetRole: 'Backend Engineer',
            requirements: [],
            keywords: ['TypeScript'],
            ambiguities: [],
        },
        finalResume: {
            resumeId: 'resume-001',
            summary: 'Approved summary.',
            markdown: '## Summary\nApproved summary.',
            claims: [],
            unresolvedGaps: [],
            decisions: [],
            changeLog: [],
        },
    };

    beforeEach(async () => {
        root = join(tmpdir(), `resume-tweak-version-test-${randomUUID()}`);
        await mkdir(root, { recursive: true });
        documents = {
            createArtifacts: jest.fn(),
            hashText: jest.fn(() => 'hash-001'),
        };
        service = new VersionService(documents as never);
        const configured = service as unknown as {
            versionsRoot: string;
            manifestPath: string;
        };
        configured.versionsRoot = join(root, 'versions');
        configured.manifestPath = join(root, 'manifests', 'resume-versions.json');
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('cleans temporary artifacts when document generation fails', async () => {
        documents.createArtifacts.mockRejectedValue(
            new Error('PDF conversion failed.'),
        );

        await expect(
            service.createApprovedVersion(approvedRun, {
                versionType: 'job-specific',
            }),
        ).rejects.toThrow('PDF conversion failed.');

        await expect(
            readdir(join(root, 'versions', 'job-specific')),
        ).rejects.toMatchObject({
            code: 'ENOENT',
        });
        expect(documents.createArtifacts).toHaveBeenCalledWith(
            expect.stringContaining('.tmp-'),
            'resume',
            approvedRun.finalResume,
        );
    });

    it('removes published output when manifest persistence fails', async () => {
        const manifestPath = join(root, 'manifests', 'resume-versions.json');
        await mkdir(join(root, 'manifests'), { recursive: true });
        await writeFile(manifestPath, '{"not":"a manifest"}', 'utf8');
        documents.createArtifacts.mockImplementation(async (directory: string) => {
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, 'resume.docx'), 'docx');
            await writeFile(join(directory, 'resume.pdf'), 'pdf');
            return {
                docxPath: join(directory, 'resume.docx'),
                pdfPath: join(directory, 'resume.pdf'),
                markdown: '## Summary\nApproved summary.',
            };
        });

        await expect(
            service.createApprovedVersion(approvedRun, {
                versionType: 'job-specific',
            }),
        ).rejects.toEqual(expect.any(BadRequestException));

        await expect(
            readdir(join(root, 'versions', 'job-specific')),
        ).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await expect(readFile(manifestPath, 'utf8')).resolves.toBe(
            '{"not":"a manifest"}',
        );
    });

    it('rejects a corrupt manifest instead of treating it as empty', async () => {
        const manifestPath = join(root, 'manifests', 'resume-versions.json');
        await mkdir(join(root, 'manifests'), { recursive: true });
        await writeFile(manifestPath, '{"not":"an array"}', 'utf8');

        await expect(service.listVersions()).rejects.toEqual(
            expect.any(BadRequestException),
        );
    });

    it('returns not found when a registered artifact is missing', async () => {
        const metadata: ResumeVersionMetadata = {
            versionId: 'version-001',
            versionType: 'job-specific',
            sourceResumeId: 'resume-001',
            tailoringRunId: 'run-001',
            targetRole: 'Backend Engineer',
            company: 'Example Company',
            createdAt: '2026-09-11T00:00:00.000Z',
            jobDescriptionHash: 'hash-001',
            modelProfileId: 'default',
            deployment: 'gpt-5.6-terra',
            includedKeywords: ['TypeScript'],
            unresolvedGaps: [],
            artifacts: {
                docxPath: 'resume.docx',
                pdfPath: 'resume.pdf',
                contentPath: 'resume-content.md',
                metadataPath: 'metadata.json',
                changeLogPath: 'change-log.md',
                reviewReportPath: 'review-report.json',
            },
            approvedAt: '2026-09-11T00:01:00.000Z',
        };
        const manifestPath = join(root, 'manifests', 'resume-versions.json');
        await mkdir(join(root, 'manifests'), { recursive: true });
        await writeFile(manifestPath, JSON.stringify([metadata]), 'utf8');

        await expect(
            service.getArtifact(metadata.versionId, 'pdf'),
        ).rejects.toEqual(expect.any(NotFoundException));
    });

    it('returns a valid artifact path when the registered file exists', async () => {
        const metadata: ResumeVersionMetadata = {
            versionId: 'version-002',
            versionType: 'general',
            sourceResumeId: 'resume-001',
            tailoringRunId: 'run-001',
            targetRole: 'Backend Engineer',
            createdAt: '2026-09-11T00:00:00.000Z',
            jobDescriptionHash: 'hash-001',
            modelProfileId: 'default',
            deployment: 'gpt-5.6-terra',
            includedKeywords: [],
            unresolvedGaps: [],
            artifacts: {
                docxPath: 'resume.docx',
                pdfPath: 'resume.pdf',
                contentPath: 'resume-content.md',
                metadataPath: 'metadata.json',
                changeLogPath: 'change-log.md',
                reviewReportPath: 'review-report.json',
            },
            approvedAt: '2026-09-11T00:01:00.000Z',
        };
        const directory = join(root, 'versions', 'general', metadata.versionId);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'resume.pdf'), 'pdf');
        await mkdir(join(root, 'manifests'), { recursive: true });
        await writeFile(
            join(root, 'manifests', 'resume-versions.json'),
            JSON.stringify([metadata]),
            'utf8',
        );

        await expect(
            service.getArtifact(metadata.versionId, 'pdf'),
        ).resolves.toMatchObject({
            path: join(directory, 'resume.pdf'),
            filename: 'backend-engineer-2026-09-11.pdf',
        });
        await expect(
            access(join(directory, 'resume.pdf')),
        ).resolves.toBeUndefined();
    });
});
