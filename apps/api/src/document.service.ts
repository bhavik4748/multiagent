import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFParse } from 'pdf-parse';
import {
  buildResumeRenderModel,
  type FinalResumePackage,
  type ResumeRenderItem,
  type ResumeRenderModel,
} from '@resume-tweak/contracts';

const execFileAsync = promisify(execFile);

@Injectable()
export class DocumentService {
  private readonly temporaryRoot = resolve(
    __dirname,
    '../../../outputs/temporary',
  );

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
    const parts: string[] = [];
    if (resume.summary?.trim()) parts.push('## Summary', resume.summary.trim());
    if (model.identity.name) parts.push(`# ${model.identity.name.text}`);
    if (model.identity.headline) parts.push(model.identity.headline.text);
    if (model.identity.contactLines.length > 0)
      parts.push(
        model.identity.contactLines.map((item) => item.text).join(' | '),
      );
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
    const children: Paragraph[] = [];
    if (model.identity.name)
      children.push(this.identityName(model.identity.name));
    if (model.identity.headline)
      children.push(this.identityHeadline(model.identity.headline));
    if (model.identity.contactLines.length > 0) {
      children.push(this.contact(model.identity.contactLines));
    }
    if (resume.summary?.trim()) {
      children.push(this.heading('Summary'), this.body(resume.summary));
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
        default: { document: { run: { font: 'Arial', size: 20 } } },
        paragraphStyles: [
          {
            id: 'ResumeHeading',
            name: 'Resume Heading',
            basedOn: 'Normal',
            next: 'Normal',
            run: { bold: true, font: 'Arial', size: 24 },
            paragraph: { spacing: { before: 220, after: 80 } },
          },
        ],
      },
      sections: [
        {
          properties: {
            page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
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
        new TextRun({ text: item.text, bold: true, font: 'Arial', size: 32 }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    });
  }

  private identityHeadline(item: ResumeRenderItem): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: item.text,
          italics: true,
          font: 'Arial',
          size: 22,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    });
  }

  private contact(items: readonly ResumeRenderItem[]): Paragraph {
    return new Paragraph({
      children: [new TextRun(items.map((item) => item.text).join(' | '))],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    });
  }

  private roleHeading(item: ResumeRenderItem): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({ text: item.text, bold: true, font: 'Arial', size: 21 }),
      ],
      spacing: { before: 100, after: 40 },
    });
  }

  private addSection(
    children: Paragraph[],
    title: string,
    items: readonly ResumeRenderItem[],
  ): void {
    if (items.length === 0) return;
    children.push(
      this.heading(title),
      ...items.map((item) => this.bullet(item.text)),
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
    const model = resume.renderModel ?? buildResumeRenderModel(resume);
    const deduplicateItems = (items: readonly ResumeRenderItem[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = this.normalize(item.text);
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
              this.normalize(previous.heading?.text ?? '') ===
              this.normalize(entry.heading?.text ?? '') &&
              previous.achievements.every((item) =>
                entry.achievements.some(
                  (candidate) =>
                    this.normalize(candidate.text) === this.normalize(item.text),
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

  private body(text: string): Paragraph {
    return new Paragraph({
      children: [new TextRun(text.trim())],
      alignment: AlignmentType.LEFT,
      spacing: { after: 100 },
    });
  }

  private bullet(text: string): Paragraph {
    return new Paragraph({
      children: [new TextRun(text.trim())],
      bullet: { level: 0 },
      spacing: { after: 80 },
    });
  }

  private headingFor(section: string): string {
    return section === 'other'
      ? 'Additional Information'
      : `${section[0].toUpperCase()}${section.slice(1)}`;
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
    await access(docxPath);
    const parser = new PDFParse({ data: await readFile(pdfPath) });
    try {
      const extractedText = (await parser.getText()).text;
      const expectedText = this.renderedText(resume)
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => this.normalize(value));
      const missing = expectedText.filter(
        (value) => !this.normalize(extractedText).includes(value),
      );
      if (missing.length > 0) {
        throw new InternalServerErrorException(
          'Generated PDF text did not match the approved resume content.',
        );
      }
    } finally {
      await parser.destroy();
    }
  }

  private normalize(value: string): string {
    return value
      .replace(/([\p{L}\p{N}])[-‐‑‒–—]\s+([\p{L}\p{N}])/gu, '$1-$2')
      .replace(/^[\s•●▪◦*-]+/, '')
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private renderedText(resume: FinalResumePackage): (string | undefined)[] {
    const model = this.getRenderModel(resume);
    return [
      model.identity.name?.text,
      model.identity.headline?.text,
      ...model.identity.contactLines.map((item) => item.text),
      resume.summary,
      ...model.skills.map((item) => item.text),
      ...model.experience.flatMap((entry) => [
        entry.heading?.text,
        ...entry.achievements.map((item) => item.text),
      ]),
      ...model.education.map((item) => item.text),
      ...model.certifications.map((item) => item.text),
      ...model.additionalInformation.map((item) => item.text),
    ];
  }
}
