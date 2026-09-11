import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildResumeRenderModel,
  type FinalResumePackage,
  type ResumeRenderItem,
  type ResumeRenderModel,
} from '@resume-tweak/contracts';
import {
  ArtifactInspectionService,
  normalizeArtifactText,
} from './artifact-inspection.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class DocumentService {
  private readonly temporaryRoot = resolve(
    __dirname,
    '../../../outputs/temporary',
  );

  constructor(
    @Inject(ArtifactInspectionService)
    private readonly artifacts = new ArtifactInspectionService(),
  ) { }

  async createArtifacts(
    outputDirectory: string,
    fileStem: string,
    resume: FinalResumePackage,
  ): Promise<{ docxPath: string; pdfPath: string; markdown: string }> {
    await mkdir(outputDirectory, { recursive: true });
    const docxPath = join(outputDirectory, `${fileStem}.docx`);
    const pdfPath = join(outputDirectory, `${fileStem}.pdf`);
    const markdown = this.renderMarkdown(resume);

    await writeFile(
      docxPath,
      await Packer.toBuffer(this.createDocument(resume)),
    );
    await this.convertToPdf(docxPath, outputDirectory, pdfPath);
    await this.verifyArtifacts(docxPath, pdfPath, resume);
    return { docxPath, pdfPath, markdown };
  }

  renderMarkdown(resume: FinalResumePackage): string {
    const model = this.getRenderModel(resume);
    const candidateSummary = this.candidateSummary(resume, model);
    const parts: string[] = [];
    if (model.identity.name) parts.push(`# ${model.identity.name.text}`);
    if (model.identity.headline) parts.push(model.identity.headline.text);
    if (model.identity.contactLines.length > 0)
      parts.push(
        model.identity.contactLines.map((item) => item.text).join(' | '),
      );
    if (candidateSummary) {
      parts.push('## Summary');
      if (model.summaryPresentation === 'bullets' && model.summary.length > 0) {
        parts.push(...model.summary.map((item) => `- ${item.text}`));
      } else {
        parts.push(candidateSummary);
      }
    }
    this.addMarkdownItems(parts, 'Skills', model.skills);
    if (model.experience.length > 0) {
      parts.push('## Experience');
      for (const entry of model.experience) {
        if (entry.heading) parts.push(`### ${entry.heading.text}`);
        parts.push(...entry.achievements.map((item) => `- ${item.text}`));
      }
    }
    this.addMarkdownItems(parts, 'Education', model.education);
    this.addMarkdownItems(parts, 'Certifications', model.certifications);
    this.addMarkdownItems(
      parts,
      'Additional Information',
      model.additionalInformation,
    );
    return parts.join('\n\n').trim();
  }

  hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private createDocument(resume: FinalResumePackage): Document {
    const model = this.getRenderModel(resume);
    const candidateSummary = this.candidateSummary(resume, model);
    const children: Paragraph[] = [];
    if (model.identity.name)
      children.push(this.identityName(model.identity.name));
    if (model.identity.headline)
      children.push(this.identityHeadline(model.identity.headline));
    if (model.identity.contactLines.length > 0) {
      children.push(this.contact(model.identity.contactLines));
    }
    if (candidateSummary) {
      children.push(
        this.heading('Summary'),
        ...(model.summaryPresentation === 'bullets' && model.summary.length > 0
          ? model.summary.map((item) => this.bullet(item.text))
          : [this.body(candidateSummary)]),
      );
    }
    this.addSection(children, 'Skills', model.skills);
    if (model.experience.length > 0) {
      children.push(this.heading('Experience'));
      for (const entry of model.experience) {
        if (entry.heading) children.push(this.roleHeading(entry.heading));
        children.push(
          ...entry.achievements.map((item) => this.bullet(item.text)),
        );
      }
    }
    this.addSection(children, 'Education', model.education);
    this.addSection(children, 'Certifications', model.certifications);
    this.addSection(
      children,
      'Additional Information',
      model.additionalInformation,
    );

    return new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 20, color: '1F2937' },
            paragraph: { spacing: { line: 276 } },
          },
        },
        paragraphStyles: [
          {
            id: 'ResumeHeading',
            name: 'Resume Heading',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              bold: true,
              font: 'Arial',
              size: 21,
              color: '1F4E79',
              allCaps: true,
            },
            paragraph: {
              spacing: { before: 180, after: 70 },
              keepNext: true,
              border: {
                bottom: {
                  color: '9CA3AF',
                  space: 2,
                  style: BorderStyle.SINGLE,
                  size: 6,
                },
              },
            },
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 648, right: 720, bottom: 648, left: 720 },
            },
          },
          children,
        },
      ],
    });
  }

  private heading(text: string): Paragraph {
    return new Paragraph({
      text,
      heading: HeadingLevel.HEADING_2,
      style: 'ResumeHeading',
    });
  }

  private identityName(item: ResumeRenderItem): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: item.text,
          bold: true,
          font: 'Arial',
          size: 30,
          color: '111827',
        }),
      ],
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { after: 35 },
    });
  }

  private identityHeadline(item: ResumeRenderItem): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: item.text,
          italics: true,
          font: 'Arial',
          size: 19,
          color: '4B5563',
        }),
      ],
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { after: 45 },
    });
  }

  private contact(items: readonly ResumeRenderItem[]): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: items.map((item) => item.text).join(' | '),
          font: 'Arial',
          size: 17,
          color: '4B5563',
        }),
      ],
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { after: 135 },
    });
  }

  private roleHeading(item: ResumeRenderItem): Paragraph {
    const [primary, ...secondary] = item.text.split('|');
    return new Paragraph({
      children: [
        new TextRun({
          text: primary.trim(),
          bold: true,
          font: 'Arial',
          size: 19,
          color: '111827',
        }),
        ...(secondary.length > 0
          ? [
            new TextRun({
              text: ` | ${secondary.join('|').trim()}`,
              font: 'Arial',
              size: 17,
              color: '4B5563',
            }),
          ]
          : []),
      ],
      keepNext: true,
      spacing: { before: 115, after: 35 },
    });
  }

  private addSection(
    children: Paragraph[],
    title: string,
    items: readonly ResumeRenderItem[],
  ): void {
    if (items.length === 0) return;
    const content =
      title === 'Skills'
        ? items.map((item) => this.skill(item.text))
        : items.map((item) => this.bullet(item.text));
    children.push(
      this.heading(title),
      ...content,
    );
  }

  private addMarkdownItems(
    parts: string[],
    title: string,
    items: readonly ResumeRenderItem[],
  ): void {
    if (items.length === 0) return;
    parts.push(`## ${title}`, ...items.map((item) => `- ${item.text}`));
  }

  private getRenderModel(resume: FinalResumePackage): ResumeRenderModel {
    const persistedModel = resume.renderModel;
    const rebuiltModel = buildResumeRenderModel(resume);
    const model =
      persistedModel &&
        (persistedModel.experience.length === 0 ||
          persistedModel.experience.some((entry) => entry.heading))
        ? persistedModel
        : rebuiltModel;
    const deduplicateItems = (items: readonly ResumeRenderItem[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = normalizeArtifactText(item.text);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const experience = model.experience
      .map((entry) => ({
        ...entry,
        achievements: deduplicateItems(entry.achievements),
      }))
      .filter(
        (entry, index, entries) =>
          !entries.slice(0, index).some(
            (previous) =>
              normalizeArtifactText(previous.heading?.text ?? '') ===
              normalizeArtifactText(entry.heading?.text ?? '') &&
              previous.achievements.every((item) =>
                entry.achievements.some(
                  (candidate) =>
                    normalizeArtifactText(candidate.text) ===
                    normalizeArtifactText(item.text),
                ),
              ),
          ),
      );
    return {
      ...model,
      identity: {
        ...model.identity,
        contactLines: deduplicateItems(model.identity.contactLines),
      },
      summary: deduplicateItems(model.summary),
      skills: deduplicateItems(model.skills),
      experience,
      education: deduplicateItems(model.education),
      certifications: deduplicateItems(model.certifications),
      additionalInformation: deduplicateItems(model.additionalInformation),
    };
  }

  private candidateSummary(
    resume: FinalResumePackage,
    model: ResumeRenderModel,
  ): string | undefined {
    const summaryClaims = model.summary
      .map((item) => item.text.trim())
      .filter(Boolean);
    if (summaryClaims.length > 0) return summaryClaims.join(' ');
    return resume.summary?.trim();
  }

  private body(text: string): Paragraph {
    return new Paragraph({
      children: [new TextRun(text.trim())],
      alignment: AlignmentType.LEFT,
      keepLines: true,
      spacing: { after: 90 },
    });
  }

  private bullet(text: string): Paragraph {
    return new Paragraph({
      children: [new TextRun(text.trim())],
      bullet: { level: 0 },
      indent: { left: 360, hanging: 180 },
      keepLines: true,
      spacing: { after: 55 },
    });
  }

  private skill(text: string): Paragraph {
    const separator = text.indexOf(':');
    const label = separator >= 0 ? text.slice(0, separator + 1) : undefined;
    const value = separator >= 0 ? text.slice(separator + 1).trim() : text;
    return new Paragraph({
      children: [
        ...(label
          ? [
            new TextRun({
              text: `${label} `,
              bold: true,
              font: 'Arial',
              size: 18,
              color: '1F2937',
            }),
          ]
          : []),
        new TextRun({ text: value, font: 'Arial', size: 18 }),
      ],
      keepLines: true,
      spacing: { after: 35 },
    });
  }

  private async convertToPdf(
    docxPath: string,
    outputDirectory: string,
    expectedPdfPath: string,
  ): Promise<void> {
    const soffice = process.platform === 'win32' ? 'soffice.exe' : 'soffice';
    const profile = join(
      this.temporaryRoot,
      `libreoffice-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await mkdir(profile, { recursive: true });
    try {
      await execFileAsync(soffice, [
        `-env:UserInstallation=file:///${profile.replace(/\\/g, '/')}`,
        '--headless',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        outputDirectory,
        docxPath,
      ]);
    } catch (error) {
      throw new InternalServerErrorException(
        `PDF generation requires LibreOffice on PATH. ${error instanceof Error ? error.message : 'Conversion failed.'}`,
      );
    } finally {
      await rm(profile, { recursive: true, force: true });
    }

    const generatedPdfPath = join(
      outputDirectory,
      `${basename(docxPath, '.docx')}.pdf`,
    );
    if (!existsSync(generatedPdfPath)) {
      throw new InternalServerErrorException(
        'LibreOffice did not produce a PDF artifact.',
      );
    }
    if (generatedPdfPath !== expectedPdfPath)
      await copyFile(generatedPdfPath, expectedPdfPath);
  }

  private async verifyArtifacts(
    docxPath: string,
    pdfPath: string,
    resume: FinalResumePackage,
  ): Promise<void> {
    const [docx, pdf] = await Promise.all([
      this.artifacts.inspectDocx(docxPath),
      this.artifacts.inspectPdf(pdfPath),
    ]);
    const violations = [...docx.violations, ...pdf.violations];
    if (violations.length > 0) {
      throw new InternalServerErrorException(
        `Generated artifacts failed safety inspection: ${violations.map((violation) => violation.code).join(', ')}.`,
      );
    }

    const expected = this.expectedExportSequence(resume);
    this.assertExpectedContent('DOCX', docx.text, expected);
    this.assertExpectedContent('PDF', pdf.text, expected);
  }

  private assertExpectedContent(
    artifact: 'DOCX' | 'PDF',
    text: string,
    expected: readonly string[],
  ): void {
    const normalizedArtifact = normalizeArtifactText(text);
    let previousIndex = -1;
    for (const value of expected) {
      const normalized = normalizeArtifactText(value);
      const index = normalizedArtifact.indexOf(normalized, previousIndex + 1);
      if (index < 0) {
        throw new InternalServerErrorException(
          `Generated ${artifact} omitted approved render-model content.`,
        );
      }
      const normalizedLines = text
        .split(/\r?\n/u)
        .map((line) => normalizeArtifactText(line));
      if (normalizedLines.filter((line) => line === normalized).length > 1) {
        throw new InternalServerErrorException(
          `Generated ${artifact} contains duplicate approved render-model content.`,
        );
      }
      previousIndex = index;
    }
  }

  private expectedExportSequence(resume: FinalResumePackage): string[] {
    const model = this.getRenderModel(resume);
    const sequence: (string | undefined)[] = [
      model.identity.name?.text,
      model.identity.headline?.text,
      ...model.identity.contactLines.map((item) => item.text),
    ];
    if (this.candidateSummary(resume, model)) {
      sequence.push('Summary');
      sequence.push(
        ...(model.summary.length > 0
          ? model.summary.map((item) => item.text)
          : [this.candidateSummary(resume, model)]),
      );
    }
    const addSection = (heading: string, values: readonly ResumeRenderItem[]) => {
      if (values.length > 0) sequence.push(heading, ...values.map((item) => item.text));
    };
    addSection('Skills', model.skills);
    if (model.experience.length > 0) {
      sequence.push('Experience');
      sequence.push(...model.experience.flatMap((entry) => [
        entry.heading?.text,
        ...entry.achievements.map((item) => item.text),
      ]));
    }
    addSection('Education', model.education);
    addSection('Certifications', model.certifications);
    addSection('Additional Information', model.additionalInformation);
    const seen = new Set<string>();
    return sequence.filter((value): value is string => {
      const normalized = normalizeArtifactText(value ?? '');
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
}
