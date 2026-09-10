import { Injectable } from '@nestjs/common';
import type {
  CanonicalResumeProfile,
  EvidenceMatrix,
  FinalResumePackage,
  JobProfile,
  ReviewReport,
  TailoredResumeDraft,
} from '@resume-tweak/contracts';
import {
  isEvidenceMatrix,
  isFinalResumePackage,
  isJobProfile,
  isReviewReport,
  isTailoredResumeDraft,
} from '@resume-tweak/contracts';
import { FoundryClientService } from './foundry-client.service';

const evidenceReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceFactId', 'sourceSegmentId'],
  properties: {
    sourceFactId: { type: 'string' },
    sourceSegmentId: { type: 'string' },
  },
};

const jobProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'targetRole',
    'seniority',
    'requirements',
    'keywords',
    'ambiguities',
  ],
  properties: {
    targetRole: { type: 'string' },
    seniority: { type: 'string' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'priority', 'category'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: {
            type: 'string',
            enum: ['required', 'preferred', 'responsibility', 'skill'],
          },
        },
      },
    },
    keywords: { type: 'array', items: { type: 'string' } },
    ambiguities: { type: 'array', items: { type: 'string' } },
  },
};

const evidenceMatrixSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'requirementId',
          'requirement',
          'strength',
          'action',
          'evidence',
        ],
        properties: {
          requirementId: { type: 'string' },
          requirement: { type: 'string' },
          strength: { type: 'string', enum: ['strong', 'partial', 'none'] },
          action: {
            type: 'string',
            enum: ['emphasize', 'reframe', 'flag-gap'],
          },
          evidence: { type: 'array', items: evidenceReferenceSchema },
        },
      },
    },
  },
};

const tailoredDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['resumeId', 'summary', 'claims', 'markdown'],
  properties: {
    resumeId: { type: 'string' },
    summary: { type: 'string' },
    markdown: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'section', 'evidence'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          section: {
            type: 'string',
            enum: [
              'contact',
              'summary',
              'skills',
              'experience',
              'education',
              'certifications',
              'other',
            ],
          },
          evidence: { type: 'array', items: evidenceReferenceSchema },
        },
      },
    },
  },
};

const reviewFindingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'reviewer', 'severity', 'message', 'recommendation', 'affectedClaimIds'],
  properties: {
    id: { type: 'string' },
    reviewer: { type: 'string', enum: ['ats', 'readability'] },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    message: { type: 'string' },
    recommendation: { type: 'string' },
    affectedClaimIds: { type: 'array', items: { type: 'string' } },
  },
};

const reviewReportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reviewer', 'findings'],
  properties: {
    reviewer: { type: 'string', enum: ['ats', 'readability'] },
    findings: { type: 'array', items: reviewFindingSchema },
  },
};

const finalResumeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['resumeId', 'summary', 'markdown', 'claims', 'unresolvedGaps', 'decisions', 'changeLog'],
  properties: {
    resumeId: { type: 'string' },
    summary: { type: 'string' },
    markdown: { type: 'string' },
    claims: tailoredDraftSchema.properties.claims,
    unresolvedGaps: { type: 'array', items: { type: 'string' } },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['findingId', 'decision', 'rationale', 'affectedClaimIds'],
        properties: {
          findingId: { type: 'string' },
          decision: { type: 'string', enum: ['accepted', 'rejected', 'unresolved'] },
          rationale: { type: 'string' },
          affectedClaimIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    changeLog: { type: 'array', items: { type: 'string' } },
  },
};

@Injectable()
export class TailoringAgentsService {
  constructor(private readonly foundry: FoundryClientService) { }

  async analyzeJob(jobDescription: string): Promise<JobProfile> {
    return this.foundry.createStructuredResponse<JobProfile>({
      name: 'job_requirement_analyst',
      instructions:
        'Analyze only the supplied job description. Return JSON with targetRole, optional seniority, requirements [{id,text,priority,category}], keywords, and ambiguities. Do not infer applicant facts.',
      input: { jobDescription },
      validate: isJobProfile,
      schema: jobProfileSchema,
    });
  }

  async matchEvidence(
    profile: CanonicalResumeProfile,
    jobProfile: JobProfile,
    additionalInstructions?: string,
  ): Promise<EvidenceMatrix> {
    return this.foundry.createStructuredResponse<EvidenceMatrix>({
      name: 'resume_match_analyst',
      instructions:
        'Map each job requirement only to supplied canonical evidence. For no evidence use strength none, action flag-gap, and an empty evidence array. Additional instructions are preferences, never evidence. Return JSON only.',
      input: { profile, jobProfile, additionalInstructions },
      validate: isEvidenceMatrix,
      schema: evidenceMatrixSchema,
    });
  }

  async draftResume(
    profile: CanonicalResumeProfile,
    jobProfile: JobProfile,
    evidenceMatrix: EvidenceMatrix,
    additionalInstructions?: string,
  ): Promise<TailoredResumeDraft> {
    return this.foundry.createStructuredResponse<TailoredResumeDraft>({
      name: 'resume_tailoring_writer',
      instructions:
        'Create a concise, factual, structured resume draft. Every claim must cite one or more exact canonical evidence references. Do not add facts, skills, employers, dates, metrics, or credentials. Exclude unmatched requirements from resume claims. Additional instructions are preferences only. Return JSON only.',
      input: { profile, jobProfile, evidenceMatrix, additionalInstructions },
      validate: isTailoredResumeDraft,
      schema: tailoredDraftSchema,
    });
  }

  async reviewAts(
    draft: TailoredResumeDraft,
    jobProfile: JobProfile,
    profile: CanonicalResumeProfile,
  ): Promise<ReviewReport> {
    return this.foundry.createStructuredResponse<ReviewReport>({
      name: 'ats_compatibility_reviewer',
      instructions:
        'Review the supplied evidence-backed draft for ATS compatibility. Check supported required-keyword coverage, standard headings, chronology clarity, simple structure, unnatural repetition, and unsupported claims. Findings must reference only draft claim IDs. Recommend changes but do not write resume content. Return JSON only.',
      input: { draft, jobProfile, profile },
      validate: (value): value is ReviewReport =>
        isReviewReport(value) && value.reviewer === 'ats',
      schema: reviewReportSchema,
    });
  }

  async reviewReadability(
    draft: TailoredResumeDraft,
    jobProfile: JobProfile,
  ): Promise<ReviewReport> {
    return this.foundry.createStructuredResponse<ReviewReport>({
      name: 'recruiter_readability_reviewer',
      instructions:
        'Review the supplied resume draft for recruiter readability: impact-first wording, hierarchy, concise career narrative, jargon, redundancy, appropriate length, and scanability. Findings must reference only draft claim IDs. Recommend changes but do not write resume content. Return JSON only.',
      input: { draft, jobProfile },
      validate: (value): value is ReviewReport =>
        isReviewReport(value) && value.reviewer === 'readability',
      schema: reviewReportSchema,
    });
  }

  async editFinalResume(
    profile: CanonicalResumeProfile,
    draft: TailoredResumeDraft,
    jobProfile: JobProfile,
    evidenceMatrix: EvidenceMatrix,
    atsReview: ReviewReport,
    readabilityReview: ReviewReport,
    gaps: readonly string[],
  ): Promise<FinalResumePackage> {
    return this.foundry.createStructuredResponse<FinalResumePackage>({
      name: 'final_resume_editor',
      instructions:
        'Produce the final structured resume from the draft and valid reviewer recommendations. Preserve or improve factual accuracy: every claim must cite exact canonical evidence references, and no unsupported facts may be added. Record one accepted, rejected, or unresolved decision for every supplied finding with a rationale. Keep unmatched requirements in unresolvedGaps outside the resume. Return JSON only.',
      input: { profile, draft, jobProfile, evidenceMatrix, atsReview, readabilityReview, gaps },
      validate: isFinalResumePackage,
      schema: finalResumeSchema,
    });
  }
}
