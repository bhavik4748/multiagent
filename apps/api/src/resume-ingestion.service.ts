import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractRawText } from 'mammoth';
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

@Injectable()
export class ResumeIngestionService {
  private readonly dataRoot = resolve(__dirname, '../../../data');

  async ingestDocx(file: Express.Multer.File): Promise<CanonicalResumeProfile> {
    this.validateDocx(file);

    const resumeId = `resume-${randomUUID()}`;
    const resumeDirectory = join(this.dataRoot, 'base', resumeId);
    const sourcePath = join(resumeDirectory, 'source.docx');
    const profilePath = join(resumeDirectory, 'canonical-resume.json');
    let extraction: Awaited<ReturnType<typeof extractRawText>>;
    try {
      extraction = await extractRawText({ buffer: file.buffer });
    } catch {
      throw new BadRequestException(
        'The uploaded file is not a readable DOCX.',
      );
    }
    const paragraphs = extraction.value
      .split(/\r?\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      throw new BadRequestException('The DOCX contains no extractable text.');
    }

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

  private validateDocx(
    file: Express.Multer.File | undefined,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException('A DOCX file is required.');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('The DOCX file must be 10 MB or smaller.');
    }
    if (
      !file.originalname.toLowerCase().endsWith('.docx') ||
      !DOCX_MIME_TYPES.has(file.mimetype)
    ) {
      throw new BadRequestException(
        'Only DOCX files are supported in Phase 1.',
      );
    }
  }
}
