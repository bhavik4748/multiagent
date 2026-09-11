import { InternalServerErrorException } from '@nestjs/common';
import { DocumentService } from './document.service';

describe('DocumentService artifact verification', () => {
  const resume = {
    resumeId: 'resume-001', summary: 'Approved summary.', markdown: '# Candidate', claims: [], unresolvedGaps: [], decisions: [], changeLog: [],
    renderModel: {
      schemaVersion: '1' as const,
      identity: { name: { id: 'name', text: 'Candidate Name', evidence: [] }, contactLines: [{ id: 'email', text: 'candidate@example.test', evidence: [] }] },
      summary: [{ id: 'summary', text: 'Approved summary.', evidence: [] }],
      skills: [{ id: 'skill', text: 'TypeScript', evidence: [] }],
      experience: [{ id: 'experience-1', heading: { id: 'role', text: 'Engineer | Northwind | 2022 - Present', evidence: [] }, achievements: [{ id: 'achievement', text: 'Built approved APIs.', evidence: [] }] }],
      education: [], certifications: [], additionalInformation: [],
    },
  };
  const renderedText = ['Candidate Name', 'candidate@example.test', 'Summary', 'Approved summary.', 'Skills', 'TypeScript', 'Experience', 'Engineer | Northwind | 2022 - Present', 'Built approved APIs.'].join('\n');
  const makeService = (docxText = renderedText, pdfText = renderedText, violations = [] as never[]) => new DocumentService({
    inspectDocx: jest.fn().mockResolvedValue({ text: docxText, paragraphs: [], violations }),
    inspectPdf: jest.fn().mockResolvedValue({ text: pdfText, pages: [pdfText], pageCount: 1, violations }),
  } as never);
  const verify = (service: DocumentService) => (service as unknown as { verifyArtifacts: (docx: string, pdf: string, value: typeof resume) => Promise<void> }).verifyArtifacts.bind(service);

  it('verifies ordered approved render-model content in both artifacts', async () => {
    await expect(verify(makeService())('resume.docx', 'resume.pdf', resume)).resolves.toBeUndefined();
  });
  it('rejects omitted rendered content', async () => {
    await expect(verify(makeService(renderedText.replace('TypeScript\n', '')))('resume.docx', 'resume.pdf', resume)).rejects.toEqual(expect.objectContaining({ message: 'Generated DOCX omitted approved render-model content.' }) as InternalServerErrorException);
  });
  it('rejects duplicate rendered content', async () => {
    await expect(verify(makeService(`${renderedText}\nTypeScript`))('resume.docx', 'resume.pdf', resume)).rejects.toEqual(expect.objectContaining({ message: 'Generated DOCX contains duplicate approved render-model content.' }) as InternalServerErrorException);
  });
  it('rejects DOCX/PDF content drift', async () => {
    await expect(verify(makeService(renderedText, renderedText.replace('TypeScript', 'JavaScript')))('resume.docx', 'resume.pdf', resume)).rejects.toEqual(expect.objectContaining({ message: 'Generated PDF omitted approved render-model content.' }) as InternalServerErrorException);
  });
  it('renders identity, section hierarchy, and role headings', () => {
    const markdown = makeService().renderMarkdown(resume);
    expect(markdown).toContain('# Candidate Name');
    expect(markdown).toContain('candidate@example.test');
    expect(markdown).toContain('## Experience');
    expect(markdown).toContain('### Engineer | Northwind | 2022 - Present');
  });
});
