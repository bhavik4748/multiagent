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
  CanonicalResumeStructure,
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

    const classifiedParagraphs = this.classifyParagraphs(paragraphs);
    const sourceSegments: ResumeSourceSegment[] = classifiedParagraphs.map(
      ({ text, section, isHeading }, index) => ({
        id: `segment-${String(index + 1).padStart(4, '0')}`,
        text,
        sequence: index,
        section,
        isHeading,
      }),
    );
    const claims: ResumeClaim[] = sourceSegments.map((segment) => ({
      id: `fact-${String(segment.sequence + 1).padStart(4, '0')}`,
      text: segment.text,
      section: segment.section ?? 'other',
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
      structure: this.buildStructure(claims),
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
    approvedClaims: { id: string; text: string; section?: ResumeSection }[],
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
      if (
        !extractedClaim ||
        !text ||
        (approvedClaim.section && !this.isResumeSection(approvedClaim.section))
      ) {
        throw new BadRequestException(
          'Approved claims must reference extracted claims and include text.',
        );
      }
      return {
        ...extractedClaim,
        text,
        section: approvedClaim.section ?? extractedClaim.section,
      };
    });
    const approvedProfile: CanonicalResumeProfile = {
      ...profile,
      claims,
      structure: this.buildStructure(claims),
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
    const normalized = this.normalizeForClassification(text);
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

  private classifyParagraphs(
    paragraphs: string[],
  ): { text: string; section: ResumeSection; isHeading: boolean }[] {
    let activeSection: ResumeSection | undefined;
    return paragraphs.map((text) => {
      const section = this.classifySection(text);
      const isHeading = this.isSectionHeading(text);
      if (isHeading) activeSection = section;
      const contextualSection =
        isHeading || !activeSection ? section : activeSection;
      return { text, section: contextualSection, isHeading };
    });
  }

  private isSectionHeading(text: string): boolean {
    const normalized = this.normalizeForClassification(text);
    return /^(experience|work experience|employment|professional experience|education|academic background|skills|technical skills|core competencies|technologies|summary|profile|professional summary|objective|certifications|certificates|licenses)$/.test(
      normalized,
    );
  }

  private normalizeForClassification(text: string): string {
    return text
      .toLowerCase()
      .replace(/^[•●▪*-]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isResumeSection(value: string): value is ResumeSection {
    return [
      'contact',
      'summary',
      'skills',
      'experience',
      'education',
      'certifications',
      'other',
    ].includes(value);
  }

  private buildStructure(claims: readonly ResumeClaim[]): CanonicalResumeStructure {
    const content = claims.filter((claim) => !this.isSectionHeading(claim.text));
    const other = content.filter((claim) => claim.section === 'other');
    const name = other.find((claim) => /^[A-Z][A-Z .'-]{1,59}$/.test(claim.text));
    const headline = name
      ? other.find(
        (claim) =>
          claim.id !== name.id &&
          claim.text.length <= 100 &&
          !/[.!?]$/.test(claim.text.trim()),
      )
      : undefined;
    const groupsFor = (
      section: ResumeSection,
      prefix: string,
      roleHeadings = false,
    ) => {
      const sectionClaims = content.filter((claim) => claim.section === section);
      if (!roleHeadings) {
        return sectionClaims.length
          ? [{ id: `${prefix}-1`, itemFactIds: sectionClaims.map((claim) => claim.id) }]
          : [];
      }
      const groups: { id: string; headingFactId?: string; itemFactIds: string[] }[] = [];
      let current: (typeof groups)[number] | undefined;
      for (const claim of sectionClaims) {
        const heading = /\|/.test(claim.text) && /\b(19|20)\d{2}\b|present/i.test(claim.text);
        if (!current || heading) {
          current = { id: `${prefix}-${groups.length + 1}`, itemFactIds: [] };
          if (heading) current.headingFactId = claim.id;
          else current.itemFactIds.push(claim.id);
          groups.push(current);
        } else {
          current.itemFactIds.push(claim.id);
        }
      }
      return groups;
    };

    return {
      identity: {
        ...(name ? { nameFactId: name.id } : {}),
        ...(headline ? { headlineFactId: headline.id } : {}),
        contactFactIds: content
          .filter((claim) => claim.section === 'contact')
          .map((claim) => claim.id),
      },
      skillGroups: groupsFor('skills', 'skills'),
      experienceEntries: groupsFor('experience', 'experience', true),
      educationEntries: groupsFor('education', 'education'),
      certificationFactIds: content
        .filter((claim) => claim.section === 'certifications')
        .map((claim) => claim.id),
    };
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
