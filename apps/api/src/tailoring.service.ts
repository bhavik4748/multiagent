import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  hasInvalidEvidenceReferences,
  type TailoringRequest,
  type TailoringRunResult,
} from '@resume-tweak/contracts';
import { ModelConfigService } from './model-config.service';
import { ResumeIngestionService } from './resume-ingestion.service';
import { TailoringAgentsService } from './tailoring-agents.service';

@Injectable()
export class TailoringService {
  private readonly runsRoot = resolve(
    __dirname,
    '../../../data/tailoring-runs',
  );

  constructor(
    private readonly resumes: ResumeIngestionService,
    private readonly agents: TailoringAgentsService,
    private readonly modelConfig: ModelConfigService,
  ) {}

  async createRun(
    resumeId: string,
    request: TailoringRequest,
  ): Promise<TailoringRunResult> {
    const profile = await this.resumes.getProfile(resumeId);
    if (profile.status !== 'approved') {
      throw new BadRequestException(
        'Tailoring requires an approved factual profile.',
      );
    }

    const runId = `run-${randomUUID()}`;
    const profileConfig = this.modelConfig.getActiveProfile();
    const createdAt = new Date().toISOString();
    try {
      const jobProfile = await this.agents.analyzeJob(request.jobDescription);
      const evidenceMatrix = await this.agents.matchEvidence(
        profile,
        jobProfile,
        request.additionalInstructions,
      );
      this.validateMatrix(
        profile,
        jobProfile.requirements.map((item) => item.id),
        evidenceMatrix,
      );
      const tailoredDraft = await this.agents.draftResume(
        profile,
        jobProfile,
        evidenceMatrix,
        request.additionalInstructions,
      );
      if (
        tailoredDraft.resumeId !== resumeId ||
        hasInvalidEvidenceReferences(profile, tailoredDraft.claims)
      ) {
        throw new BadRequestException(
          'The tailoring workflow returned unsupported draft evidence.',
        );
      }
      const gaps = evidenceMatrix.rows
        .filter((row) => row.strength === 'none')
        .map((row) => row.requirement);
      const [atsReview, readabilityReview] = await Promise.all([
        this.agents.reviewAts(tailoredDraft, jobProfile, profile),
        this.agents.reviewReadability(tailoredDraft, jobProfile),
      ]);
      this.validateReviewFindings(tailoredDraft, atsReview, readabilityReview);
      const finalResume = await this.agents.editFinalResume(
        profile,
        tailoredDraft,
        jobProfile,
        evidenceMatrix,
        atsReview,
        readabilityReview,
        gaps,
      );
      this.validateFinalResume(
        profile,
        resumeId,
        finalResume,
        atsReview,
        readabilityReview,
        gaps,
      );
      const result: TailoringRunResult = {
        runId,
        resumeId,
        status: 'completed',
        createdAt,
        completedAt: new Date().toISOString(),
        jobProfile,
        evidenceMatrix,
        tailoredDraft,
        atsReview,
        readabilityReview,
        finalResume,
        reviewStatus: 'completed',
        reviewCompletedAt: new Date().toISOString(),
        approvalStatus: 'pending',
        gaps,
        additionalInstructions:
          request.additionalInstructions?.trim() || undefined,
        modelProfileId: profileConfig.id,
        deployment: profileConfig.deployment,
      };
      await this.persist(result);
      return result;
    } catch (error) {
      const result: TailoringRunResult = {
        runId,
        resumeId,
        status: 'failed',
        createdAt,
        completedAt: new Date().toISOString(),
        gaps: [],
        reviewStatus: 'failed',
        reviewError: error instanceof Error ? error.message : 'Review failed.',
        approvalStatus: 'pending',
        additionalInstructions:
          request.additionalInstructions?.trim() || undefined,
        modelProfileId: profileConfig.id,
        deployment: profileConfig.deployment,
        error: error instanceof Error ? error.message : 'Tailoring failed.',
      };
      await this.persist(result);
      return result;
    }
  }

  async getRun(runId: string): Promise<TailoringRunResult> {
    try {
      return JSON.parse(
        await readFile(join(this.runsRoot, `${runId}.json`), 'utf8'),
      ) as TailoringRunResult;
    } catch {
      throw new NotFoundException(`Tailoring run '${runId}' was not found.`);
    }
  }

  async approveRun(
    runId: string,
    approvalNote?: string,
  ): Promise<TailoringRunResult> {
    const run = await this.getRun(runId);
    if (
      run.status !== 'completed' ||
      run.reviewStatus !== 'completed' ||
      !run.finalResume
    ) {
      throw new BadRequestException(
        'Only a completed, reviewed tailoring run can be approved.',
      );
    }
    if (run.approvalStatus === 'approved') {
      return run;
    }
    const approved: TailoringRunResult = {
      ...run,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      approvalNote: approvalNote?.trim() || undefined,
    };
    await this.persist(approved);
    return approved;
  }

  private validateMatrix(
    profile: Awaited<ReturnType<ResumeIngestionService['getProfile']>>,
    requirementIds: string[],
    matrix: import('@resume-tweak/contracts').EvidenceMatrix,
  ) {
    const mappedRequirementIds = new Set(
      matrix.rows.map((row) => row.requirementId),
    );
    if (
      matrix.rows.length === 0 ||
      matrix.rows.some((row) => !requirementIds.includes(row.requirementId)) ||
      requirementIds.some(
        (requirementId) => !mappedRequirementIds.has(requirementId),
      )
    ) {
      throw new BadRequestException(
        'The evidence matrix does not map valid job requirements.',
      );
    }
    if (
      hasInvalidEvidenceReferences(
        profile,
        matrix.rows.filter((row) => row.evidence.length > 0),
      )
    ) {
      throw new BadRequestException(
        'The evidence matrix contains invalid source references.',
      );
    }
    if (
      matrix.rows.some(
        (row) =>
          row.strength === 'none' &&
          (row.action !== 'flag-gap' || row.evidence.length > 0),
      )
    ) {
      throw new BadRequestException(
        'Unmatched requirements must be recorded as gaps, not claims.',
      );
    }
  }

  private validateReviewFindings(
    draft: import('@resume-tweak/contracts').TailoredResumeDraft,
    ...reports: import('@resume-tweak/contracts').ReviewReport[]
  ) {
    const draftClaimIds = new Set(draft.claims.map((claim) => claim.id));
    const findingIds = new Set<string>();
    if (
      reports.some((report) =>
        report.findings.some(
          (finding) =>
            findingIds.has(finding.id) ||
            finding.affectedClaimIds.some((id) => !draftClaimIds.has(id)) ||
            !findingIds.add(finding.id),
        ),
      )
    ) {
      throw new BadRequestException(
        'A review report contains invalid finding or draft claim references.',
      );
    }
  }

  private validateFinalResume(
    profile: Awaited<ReturnType<ResumeIngestionService['getProfile']>>,
    resumeId: string,
    finalResume: import('@resume-tweak/contracts').FinalResumePackage,
    atsReview: import('@resume-tweak/contracts').ReviewReport,
    readabilityReview: import('@resume-tweak/contracts').ReviewReport,
    gaps: readonly string[],
  ) {
    const findingIds = new Set(
      [...atsReview.findings, ...readabilityReview.findings].map(
        (finding) => finding.id,
      ),
    );
    if (
      finalResume.resumeId !== resumeId ||
      hasInvalidEvidenceReferences(profile, finalResume.claims) ||
      finalResume.decisions.length !== findingIds.size ||
      finalResume.decisions.some(
        (decision) => !findingIds.has(decision.findingId),
      ) ||
      gaps.some((gap) => !finalResume.unresolvedGaps.includes(gap))
    ) {
      throw new BadRequestException(
        'The final editor returned invalid evidence, review decisions, or gap handling.',
      );
    }
  }

  private async persist(result: TailoringRunResult) {
    await mkdir(this.runsRoot, { recursive: true });
    await writeFile(
      join(this.runsRoot, `${result.runId}.json`),
      JSON.stringify(result, null, 2),
      'utf8',
    );
  }
}
