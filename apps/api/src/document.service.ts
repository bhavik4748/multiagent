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
import type { FinalResumePackage } from '@resume-tweak/contracts';

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
    const parts: string[] = [];
    if (resume.summary?.trim()) parts.push('## Summary', resume.summary.trim());
    for (const section of [
      'skills',
      'experience',
      'education',
      'certifications',
      'other',
    ] as const) {
      const claims = resume.claims.filter((claim) => claim.section === section);
      if (claims.length === 0) continue;
      parts.push(
        `## ${this.headingFor(section)}`,
        ...claims.map((claim) => `- ${claim.text.trim()}`),
      );
    }
    return parts.join('\n\n').trim();
  }

  hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private createDocument(resume: FinalResumePackage): Document {
    const children: Paragraph[] = [];
    if (resume.summary?.trim()) {
      children.push(this.heading('Summary'), this.body(resume.summary));
    }
    for (const section of [
      'skills',
      'experience',
      'education',
      'certifications',
      'other',
    ] as const) {
      const claims = resume.claims.filter((claim) => claim.section === section);
      if (claims.length === 0) continue;
      children.push(this.heading(this.headingFor(section)));
      children.push(...claims.map((claim) => this.bullet(claim.text)));
    }

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
      const expectedText = [
        resume.summary,
        ...resume.claims
          .filter((claim) => this.isRenderedSection(claim.section))
          .map((claim) => claim.text),
      ]
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
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private isRenderedSection(section: string): boolean {
    return [
      'skills',
      'experience',
      'education',
      'certifications',
      'other',
    ].includes(section);
  }
}
