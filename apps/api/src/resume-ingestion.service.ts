import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type {
  CanonicalResumeProfile,
  ResumeClaim,
  ResumeSection,
  ResumeSourceSegment,
} from '@resume-tweak/contracts';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
]);
const PDF_MIME_TYPES = new Set(['application/pdf', 'application/octet-stream']);

@Injectable()
export class ResumeIngestionService {
  private readonly dataRoot = resolve(__dirname, '../../../data');

  async ingest(file: Express.Multer.File): Promise<CanonicalResumeProfile> {
    this.validateUpload(file);
    const isPdf = this.isPdf(file);
    const paragraphs = isPdf
      ? await this.extractPdfParagraphs(file.buffer)
      : await this.extractDocxParagraphs(file.buffer);

    return this.persistProfile(file, paragraphs, isPdf ? 'pdf' : 'docx');
  }

  private async extractDocxParagraphs(buffer: Buffer): Promise<string[]> {
    let extraction: Awaited<ReturnType<typeof extractRawText>>;
    try {
      extraction = await extractRawText({ buffer });
    } catch {
      throw new BadRequestException(
        'The uploaded file is not a readable DOCX.',
      );
    }
    return this.toParagraphs(
      extraction.value,
      'The DOCX contains no extractable text.',
    );
  }

  private async extractPdfParagraphs(buffer: Buffer): Promise<string[]> {
    const parser = new PDFParse({ data: buffer });
    try {
      return this.toParagraphs(
        (await parser.getText()).text,
        'This PDF has no selectable text. Upload a text-based PDF or DOCX instead.',
      );
    } catch {
      throw new BadRequestException(
        'The uploaded PDF is unreadable, encrypted, or does not contain selectable text.',
      );
    } finally {
      await parser.destroy();
    }
  }

  private toParagraphs(text: string, emptyMessage: string): string[] {
    const paragraphs = text
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      throw new BadRequestException(emptyMessage);
    }
    return paragraphs;
  }

  private async persistProfile(
    file: Express.Multer.File,
    paragraphs: string[],
    sourceExtension: 'docx' | 'pdf',
  ): Promise<CanonicalResumeProfile> {
    const resumeId = `resume-${randomUUID()}`;
    const resumeDirectory = join(this.dataRoot, 'base', resumeId);
    const sourcePath = join(resumeDirectory, `source.${sourceExtension}`);
    const profilePath = join(resumeDirectory, 'canonical-resume.json');

    const sourceSegments: ResumeSourceSegment[] = paragraphs.map(
      (text, index) => ({
        id: `segment-${String(index + 1).padStart(4, '0')}`,
        text,
        sequence: index,
      }),
    );
    const claims: ResumeClaim[] = sourceSegments.map((segment) => ({
      id: `fact-${String(segment.sequence + 1).padStart(4, '0')}`,
      text: segment.text,
      section: this.classifySection(segment.text),
      evidence: [
        {
          sourceFactId: `fact-${String(segment.sequence + 1).padStart(4, '0')}`,
          sourceSegmentId: segment.id,
        },
      ],
    }));
    const profile: CanonicalResumeProfile = {
      resumeId,
      claims,
      sourceSegments,
      status: 'draft',
    };

    await mkdir(resumeDirectory, { recursive: true });
    await writeFile(sourcePath, file.buffer);
    await writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  async getProfile(resumeId: string): Promise<CanonicalResumeProfile> {
    try {
      const content = await readFile(
        join(this.dataRoot, 'base', resumeId, 'canonical-resume.json'),
        'utf8',
      );
      return JSON.parse(content) as CanonicalResumeProfile;
    } catch {
      throw new NotFoundException(`Resume '${resumeId}' was not found.`);
    }
  }

  async approveProfile(
    resumeId: string,
    approvedClaims: { id: string; text: string }[],
  ): Promise<CanonicalResumeProfile> {
    const profile = await this.getProfile(resumeId);
    const extractedClaims = new Map(
      profile.claims.map((claim) => [claim.id, claim]),
    );

    if (approvedClaims.length === 0) {
      throw new BadRequestException(
        'Approve at least one source-backed claim.',
      );
    }

    const claims = approvedClaims.map((approvedClaim) => {
      const extractedClaim = extractedClaims.get(approvedClaim.id);
      const text = approvedClaim.text.trim();
      if (!extractedClaim || !text) {
        throw new BadRequestException(
          'Approved claims must reference extracted claims and include text.',
        );
      }
      return { ...extractedClaim, text };
    });
    const approvedProfile: CanonicalResumeProfile = {
      ...profile,
      claims,
      status: 'approved',
      approvedAt: new Date().toISOString(),
    };
    await writeFile(
      join(this.dataRoot, 'base', resumeId, 'canonical-resume.json'),
      JSON.stringify(approvedProfile, null, 2),
      'utf8',
    );
    return approvedProfile;
  }

  private classifySection(text: string): ResumeSection {
    const normalized = text.toLowerCase();
    if (
      /^(experience|work experience|employment|professional experience)\b/.test(
        normalized,
      )
    )
      return 'experience';
    if (/^(education|academic background)\b/.test(normalized))
      return 'education';
    if (
      /^(skills|technical skills|core competencies|technologies)\b/.test(
        normalized,
      )
    )
      return 'skills';
    if (/^(summary|profile|professional summary|objective)\b/.test(normalized))
      return 'summary';
    if (/^(certifications|certificates|licenses)\b/.test(normalized))
      return 'certifications';
    if (/@|linkedin\.com|github\.com|\+?\d[\d\s().-]{6,}/.test(normalized))
      return 'contact';
    return 'other';
  }

  private validateUpload(
    file: Express.Multer.File | undefined,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException(
        'A DOCX or text-based PDF file is required.',
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        'The resume file must be 10 MB or smaller.',
      );
    }
    if (this.isPdf(file)) {
      if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new BadRequestException(
          'The uploaded file is not a readable PDF.',
        );
      }
      return;
    }
    if (!this.isDocx(file)) {
      throw new BadRequestException(
        'Only DOCX and text-based PDF files are supported.',
      );
    }
  }

  private isDocx(file: Express.Multer.File): boolean {
    return (
      file.originalname.toLowerCase().endsWith('.docx') &&
      DOCX_MIME_TYPES.has(file.mimetype)
    );
  }

  private isPdf(file: Express.Multer.File): boolean {
    return (
      file.originalname.toLowerCase().endsWith('.pdf') &&
      PDF_MIME_TYPES.has(file.mimetype)
    );
  }
}
