export const MODEL_PROFILE_ID = 'default' as const;
export const DEFAULT_FOUNDRY_DEPLOYMENT = 'gpt-5.6-terra' as const;

export interface ModelProfile {
    id: typeof MODEL_PROFILE_ID;
    provider: 'microsoft-foundry';
    deployment: string;
    apiVersion: string;
    enabled: boolean;
    allowedFor: readonly ['resume-tailoring'];
    maxOutputTokens: number;
}

export interface EvidenceReference {
    sourceFactId: string;
    sourceSegmentId: string;
}

export interface ResumeClaim {
    id: string;
    text: string;
    evidence: readonly EvidenceReference[];
    section: ResumeSection;
}

export type ResumeSection =
    | 'contact'
    | 'summary'
    | 'skills'
    | 'experience'
    | 'education'
    | 'certifications'
    | 'other';

export interface ResumeSourceSegment {
    id: string;
    text: string;
    sequence: number;
}

export interface CanonicalResumeProfile {
    resumeId: string;
    claims: readonly ResumeClaim[];
    sourceSegments: readonly ResumeSourceSegment[];
    status: 'draft' | 'approved';
    approvedAt?: string;
}

export type ReviewKind = 'ats' | 'readability';
export type ReviewSeverity = 'high' | 'medium' | 'low';
export type RecommendationDecisionStatus = 'accepted' | 'rejected' | 'unresolved';

export interface ReviewFinding {
    id: string;
    reviewer: ReviewKind;
    severity: ReviewSeverity;
    message: string;
    recommendation: string;
    affectedClaimIds: readonly string[];
}

export interface ReviewReport {
    reviewer: ReviewKind;
    findings: readonly ReviewFinding[];
}

export interface ReviewRecommendationDecision {
    findingId: string;
    decision: RecommendationDecisionStatus;
    rationale: string;
    affectedClaimIds: readonly string[];
}

export interface FinalResumePackage {
    resumeId: string;
    summary?: string;
    markdown: string;
    claims: readonly TailoredResumeClaim[];
    unresolvedGaps: readonly string[];
    decisions: readonly ReviewRecommendationDecision[];
    changeLog: readonly string[];
}

export type EvidenceStrength = 'strong' | 'partial' | 'none';
export type EvidenceAction = 'emphasize' | 'reframe' | 'flag-gap';

export interface JobRequirement {
    id: string;
    text: string;
    priority: 'high' | 'medium' | 'low';
    category: 'required' | 'preferred' | 'responsibility' | 'skill';
}

export interface JobProfile {
    targetRole: string;
    seniority?: string;
    requirements: readonly JobRequirement[];
    keywords: readonly string[];
    ambiguities: readonly string[];
}

export interface EvidenceMatrixRow {
    requirementId: string;
    requirement: string;
    strength: EvidenceStrength;
    action: EvidenceAction;
    evidence: readonly EvidenceReference[];
}

export interface EvidenceMatrix {
    rows: readonly EvidenceMatrixRow[];
}

export interface TailoredResumeClaim {
    id: string;
    text: string;
    section: ResumeSection;
    evidence: readonly EvidenceReference[];
}

export interface TailoredResumeDraft {
    resumeId: string;
    summary?: string;
    claims: readonly TailoredResumeClaim[];
    markdown: string;
}

export interface TailoringRequest {
    jobDescription: string;
    additionalInstructions?: string;
}

export interface TailoringRunResult {
    runId: string;
    resumeId: string;
    status: 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
    jobProfile?: JobProfile;
    evidenceMatrix?: EvidenceMatrix;
    tailoredDraft?: TailoredResumeDraft;
    atsReview?: ReviewReport;
    readabilityReview?: ReviewReport;
    finalResume?: FinalResumePackage;
    reviewStatus: 'not-started' | 'completed' | 'failed';
    reviewCompletedAt?: string;
    reviewError?: string;
    approvalStatus: 'pending' | 'approved';
    approvedAt?: string;
    approvalNote?: string;
    gaps: readonly string[];
    additionalInstructions?: string;
    modelProfileId: string;
    deployment: string;
    error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isEvidenceReference(value: unknown): value is EvidenceReference {
    return (
        isRecord(value) &&
        typeof value.sourceFactId === 'string' &&
        value.sourceFactId.length > 0 &&
        typeof value.sourceSegmentId === 'string' &&
        value.sourceSegmentId.length > 0
    );
}

/** Validates untrusted structured output returned by the Job Requirement Analyst. */
export function isJobProfile(value: unknown): value is JobProfile {
    if (
        !isRecord(value) ||
        typeof value.targetRole !== 'string' ||
        value.targetRole.length === 0 ||
        !Array.isArray(value.requirements) ||
        !isStringArray(value.keywords) ||
        !isStringArray(value.ambiguities)
    ) {
        return false;
    }

    return value.requirements.every(
        (requirement) =>
            isRecord(requirement) &&
            typeof requirement.id === 'string' &&
            requirement.id.length > 0 &&
            typeof requirement.text === 'string' &&
            requirement.text.length > 0 &&
            ['high', 'medium', 'low'].includes(String(requirement.priority)) &&
            ['required', 'preferred', 'responsibility', 'skill'].includes(
                String(requirement.category),
            ),
    );
}

/** Validates untrusted structured output returned by the Resume Match Analyst. */
export function isEvidenceMatrix(value: unknown): value is EvidenceMatrix {
    return (
        isRecord(value) &&
        Array.isArray(value.rows) &&
        value.rows.every(
            (row) =>
                isRecord(row) &&
                typeof row.requirementId === 'string' &&
                row.requirementId.length > 0 &&
                typeof row.requirement === 'string' &&
                row.requirement.length > 0 &&
                ['strong', 'partial', 'none'].includes(String(row.strength)) &&
                ['emphasize', 'reframe', 'flag-gap'].includes(String(row.action)) &&
                Array.isArray(row.evidence) &&
                row.evidence.every(isEvidenceReference),
        )
    );
}

/** Validates untrusted structured output returned by the Resume Tailoring Writer. */
export function isTailoredResumeDraft(value: unknown): value is TailoredResumeDraft {
    return (
        isRecord(value) &&
        typeof value.resumeId === 'string' &&
        value.resumeId.length > 0 &&
        (value.summary === undefined || typeof value.summary === 'string') &&
        typeof value.markdown === 'string' &&
        value.markdown.length > 0 &&
        Array.isArray(value.claims) &&
        value.claims.every(
            (claim) =>
                isRecord(claim) &&
                typeof claim.id === 'string' &&
                claim.id.length > 0 &&
                typeof claim.text === 'string' &&
                claim.text.length > 0 &&
                ['contact', 'summary', 'skills', 'experience', 'education', 'certifications', 'other'].includes(
                    String(claim.section),
                ) &&
                Array.isArray(claim.evidence) &&
                claim.evidence.length > 0 &&
                claim.evidence.every(isEvidenceReference),
        )
    );
}

/** Validates untrusted structured output returned by either Phase 3 reviewer. */
export function isReviewReport(value: unknown): value is ReviewReport {
    return (
        isRecord(value) &&
        ['ats', 'readability'].includes(String(value.reviewer)) &&
        Array.isArray(value.findings) &&
        value.findings.every(
            (finding) =>
                isRecord(finding) &&
                typeof finding.id === 'string' &&
                finding.id.length > 0 &&
                finding.reviewer === value.reviewer &&
                ['high', 'medium', 'low'].includes(String(finding.severity)) &&
                typeof finding.message === 'string' &&
                finding.message.length > 0 &&
                typeof finding.recommendation === 'string' &&
                finding.recommendation.length > 0 &&
                isStringArray(finding.affectedClaimIds),
        )
    );
}

/** Validates untrusted structured output returned by the Final Resume Editor. */
export function isFinalResumePackage(value: unknown): value is FinalResumePackage {
    return (
        isRecord(value) &&
        typeof value.resumeId === 'string' &&
        value.resumeId.length > 0 &&
        (value.summary === undefined || typeof value.summary === 'string') &&
        typeof value.markdown === 'string' &&
        value.markdown.length > 0 &&
        Array.isArray(value.claims) &&
        value.claims.every(
            (claim) =>
                isRecord(claim) &&
                typeof claim.id === 'string' &&
                claim.id.length > 0 &&
                typeof claim.text === 'string' &&
                claim.text.length > 0 &&
                ['contact', 'summary', 'skills', 'experience', 'education', 'certifications', 'other'].includes(String(claim.section)) &&
                Array.isArray(claim.evidence) &&
                claim.evidence.length > 0 &&
                claim.evidence.every(isEvidenceReference),
        ) &&
        isStringArray(value.unresolvedGaps) &&
        Array.isArray(value.decisions) &&
        value.decisions.every(
            (decision) =>
                isRecord(decision) &&
                typeof decision.findingId === 'string' &&
                decision.findingId.length > 0 &&
                ['accepted', 'rejected', 'unresolved'].includes(String(decision.decision)) &&
                typeof decision.rationale === 'string' &&
                decision.rationale.length > 0 &&
                isStringArray(decision.affectedClaimIds),
        ) &&
        isStringArray(value.changeLog)
    );
}

/** A material output claim must cite at least one canonical source fact. */
export function hasUnsupportedClaims(
    source: CanonicalResumeProfile,
    output: FinalResumePackage,
): boolean {
    const validSourceFactIds = new Set(source.claims.map((claim) => claim.id));

    return output.claims.some(
        (claim) =>
            claim.evidence.length === 0 ||
            claim.evidence.some(
                (reference) => !validSourceFactIds.has(reference.sourceFactId),
            ),
    );
}

/** Verifies that every output evidence link points to the exact approved fact and source segment. */
export function hasInvalidEvidenceReferences(
    source: CanonicalResumeProfile,
    claims: readonly { evidence: readonly EvidenceReference[] }[],
): boolean {
    const validReferences = new Set(
        source.claims.flatMap((claim) =>
            claim.evidence.map(
                (reference) => `${reference.sourceFactId}:${reference.sourceSegmentId}`,
            ),
        ),
    );

    return claims.some(
        (claim) =>
            claim.evidence.length === 0 ||
            claim.evidence.some(
                (reference) =>
                    !validReferences.has(
                        `${reference.sourceFactId}:${reference.sourceSegmentId}`,
                    ),
            ),
    );
}
