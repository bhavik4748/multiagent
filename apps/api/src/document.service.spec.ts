import { access, readFile } from 'node:fs/promises';
import { InternalServerErrorException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { DocumentService } from './document.service';

jest.mock('node:fs/promises', () => ({
  access: jest.fn(),
  readFile: jest.fn(),
}));
jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }));

describe('DocumentService artifact verification', () => {
  const service = new DocumentService();
  const verify = (
    service as unknown as {
      verifyArtifacts: (
        docxPath: string,
        pdfPath: string,
        resume: unknown,
      ) => Promise<void>;
    }
  ).verifyArtifacts.bind(service);

  const resume = {
    resumeId: 'resume-001',
    summary: 'Approved summary.',
    markdown: '# Candidate',
    claims: [
      {
        id: 'contact-name',
        text: 'Candidate Name',
        section: 'contact',
        evidence: [],
      },
      {
        id: 'draft-summary',
        text: 'An earlier summary draft.',
        section: 'summary',
        evidence: [],
      },
      {
        id: 'experience-001',
        text: 'Built approved APIs.',
        section: 'experience',
        evidence: [],
      },
    ],
    unresolvedGaps: [],
    decisions: [],
    changeLog: [],
  };

  beforeEach(() => {
    jest.mocked(access).mockResolvedValue();
    jest.mocked(readFile).mockResolvedValue(Buffer.from('pdf'));
  });

  afterEach(() => jest.restoreAllMocks());

  it('validates only content rendered in the PDF', async () => {
    const getText = jest.fn().mockResolvedValue({
      text: 'Approved summary. Candidate Name Built approved APIs.',
    });
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest
      .mocked(PDFParse)
      .mockImplementation(() => ({ getText, destroy }) as never);

    await expect(
      verify('resume.docx', 'resume.pdf', resume),
    ).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalled();
  });

  it('still rejects a rendered claim missing from the PDF', async () => {
    jest.mocked(PDFParse).mockImplementation(
      () =>
        ({
          getText: jest.fn().mockResolvedValue({ text: 'Approved summary.' }),
          destroy: jest.fn().mockResolvedValue(undefined),
        }) as never,
    );

    await expect(verify('resume.docx', 'resume.pdf', resume)).rejects.toEqual(
      expect.objectContaining({
        message:
          'Generated PDF text did not match the approved resume content.',
      }) as InternalServerErrorException,
    );
  });

  it('verifies the render model instead of stale flat claims', async () => {
    const structuredResume = {
      ...resume,
      renderModel: {
        schemaVersion: '1' as const,
        identity: {
          name: {
            id: 'name',
            text: 'Candidate Name',
            evidence: [],
          },
          contactLines: [],
        },
        summary: [],
        skills: [
          {
            id: 'skills',
            text: 'TypeScript and Azure',
            evidence: [],
          },
        ],
        experience: [
          {
            id: 'experience-1',
            heading: {
              id: 'role',
              text: 'Platform Engineer — Northwind',
              evidence: [],
            },
            achievements: [
              {
                id: 'achievement',
                text: 'Built approved APIs.',
                evidence: [],
              },
            ],
          },
        ],
        education: [],
        certifications: [],
        additionalInformation: [],
      },
    };
    jest.mocked(PDFParse).mockImplementation(
      () =>
        ({
          getText: jest.fn().mockResolvedValue({
            text: 'Candidate Name\nApproved summary.\n• TypeScript and Azure\nPlatform Engineer - Northwind\nBuilt approved APIs.',
          }),
          destroy: jest.fn().mockResolvedValue(undefined),
        }) as never,
    );

    await expect(
      verify('resume.docx', 'resume.pdf', structuredResume),
    ).resolves.toBeUndefined();
  });

  it('accepts a PDF extractor line-wrap split inside a hyphenated word', async () => {
    const hyphenatedResume = {
      ...resume,
      claims: [
        {
          id: 'experience-001',
          text: 'Defined service-decomposition decisions for high-throughput APIs.',
          section: 'experience' as const,
          evidence: [],
        },
      ],
    };
    jest.mocked(PDFParse).mockImplementation(
      () =>
        ({
          getText: jest.fn().mockResolvedValue({
            text: 'Approved summary.\nDefined service-\ndecomposition decisions for high-\nthroughput APIs.',
          }),
          destroy: jest.fn().mockResolvedValue(undefined),
        }) as never,
    );

    await expect(
      verify('resume.docx', 'resume.pdf', hyphenatedResume),
    ).resolves.toBeUndefined();
  });

  it('removes repeated legacy render-model items before export', () => {
    const markdown = service.renderMarkdown({
      ...resume,
      renderModel: {
        schemaVersion: '1',
        identity: { contactLines: [] },
        summary: [],
        skills: [
          { id: 'skill-1', text: 'TypeScript', evidence: [] },
          { id: 'skill-2', text: 'TypeScript', evidence: [] },
        ],
        experience: [],
        education: [],
        certifications: [],
        additionalInformation: [],
      },
    });

    expect(markdown.match(/TypeScript/g)).toHaveLength(1);
  });
});
