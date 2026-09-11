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
    section?: ResumeSection;
    isHeading?: boolean;
}

export interface CanonicalResumeIdentity {
    nameFactId?: string;
    headlineFactId?: string;
    contactFactIds: readonly string[];
}

export interface CanonicalResumeGroup {
    id: string;
    headingFactId?: string;
    itemFactIds: readonly string[];
}

export interface CanonicalResumeStructure {
    identity: CanonicalResumeIdentity;
    skillGroups: readonly CanonicalResumeGroup[];
    experienceEntries: readonly CanonicalResumeGroup[];
    educationEntries: readonly CanonicalResumeGroup[];
    certificationFactIds: readonly string[];
}

export interface CanonicalResumeProfile {
    resumeId: string;
    /** SHA-256 fingerprint of the immutable uploaded source artifact. */
    sourceHash?: string;
    sourceFormat?: 'docx' | 'pdf';
    claims: readonly ResumeClaim[];
    sourceSegments: readonly ResumeSourceSegment[];
    structure?: CanonicalResumeStructure;
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

export interface ResumeRenderItem {
    id: string;
    text: string;
    evidence: readonly EvidenceReference[];
}

export interface ResumeRenderIdentity {
    name?: ResumeRenderItem;
    headline?: ResumeRenderItem;
    contactLines: readonly ResumeRenderItem[];
}

export interface ResumeRenderExperienceEntry {
    id: string;
    heading?: ResumeRenderItem;
    achievements: readonly ResumeRenderItem[];
}

export type SummaryPresentation = 'paragraph' | 'bullets';

export interface ResumeRenderModel {
    schemaVersion: '1';
    identity: ResumeRenderIdentity;
    summary: readonly ResumeRenderItem[];
    summaryPresentation?: SummaryPresentation;
    skills: readonly ResumeRenderItem[];
    experience: readonly ResumeRenderExperienceEntry[];
    education: readonly ResumeRenderItem[];
    certifications: readonly ResumeRenderItem[];
    additionalInformation: readonly ResumeRenderItem[];
}

export interface FinalResumePackage {
    resumeId: string;
    summary?: string;
    summaryPresentation?: SummaryPresentation;
    markdown: string;
    claims: readonly TailoredResumeClaim[];
    unresolvedGaps: readonly string[];
    decisions: readonly ReviewRecommendationDecision[];
    changeLog: readonly string[];
    renderModel?: ResumeRenderModel;
}

export type ResumeVersionType = 'general' | 'targeted' | 'job-specific';

export interface ResumeVersionArtifacts {
    docxPath: string;
    pdfPath: string;
    contentPath: string;
    metadataPath: string;
    changeLogPath: string;
    reviewReportPath: string;
}

export interface ResumeVersionMetadata {
    versionId: string;
    versionType: ResumeVersionType;
    track?: string;
    sourceResumeId: string;
    tailoringRunId: string;
    targetRole: string;
    company?: string;
    createdAt: string;
    jobDescriptionHash: string;
    modelProfileId: string;
    deployment: string;
    includedKeywords: readonly string[];
    unresolvedGaps: readonly string[];
    artifacts: ResumeVersionArtifacts;
    approvedAt: string;
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

function isResumeRenderItem(value: unknown): value is ResumeRenderItem {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.text === 'string' &&
        value.text.trim().length > 0 &&
        Array.isArray(value.evidence) &&
        value.evidence.length > 0 &&
        value.evidence.every(isEvidenceReference)
    );
}

export function isResumeRenderModel(value: unknown): value is ResumeRenderModel {
    if (
        !isRecord(value) ||
        value.schemaVersion !== '1' ||
        !isRecord(value.identity) ||
        !Array.isArray(value.summary) ||
        !Array.isArray(value.skills) ||
        !Array.isArray(value.experience) ||
        !Array.isArray(value.education) ||
        !Array.isArray(value.certifications) ||
        !Array.isArray(value.additionalInformation)
    ) {
        return false;
    }

    const identity = value.identity;
    const validIdentity =
        (identity.name === undefined || isResumeRenderItem(identity.name)) &&
        (identity.headline === undefined || isResumeRenderItem(identity.headline)) &&
        Array.isArray(identity.contactLines) &&
        identity.contactLines.every(isResumeRenderItem);
    const validExperience = value.experience.every(
        (entry) =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            entry.id.length > 0 &&
            (entry.heading === undefined || isResumeRenderItem(entry.heading)) &&
            Array.isArray(entry.achievements) &&
            entry.achievements.every(isResumeRenderItem),
    );

    return (
        validIdentity &&
        value.summary.every(isResumeRenderItem) &&
        value.skills.every(isResumeRenderItem) &&
        validExperience &&
        value.education.every(isResumeRenderItem) &&
        value.certifications.every(isResumeRenderItem) &&
        value.additionalInformation.every(isResumeRenderItem)
    );
}

function renderItem(claim: TailoredResumeClaim): ResumeRenderItem {
    return { id: claim.id, text: claim.text.trim(), evidence: claim.evidence };
}

function isSectionHeading(text: string): boolean {
    return /^(summary|professional summary|profile|skills|technical skills|core competencies|technologies|experience|work experience|professional experience|employment|education|academic background|certifications|certificates|licenses)$/i.test(
        text.trim(),
    );
}

function looksLikeExperienceHeading(text: string): boolean {
    return /\|/.test(text) && /\b(19|20)\d{2}\b|present/i.test(text);
}

function looksLikeName(text: string): boolean {
    return /^[A-Z][A-Z .'-]{1,59}$/.test(text.trim()) && text.trim().split(/\s+/).length <= 5;
}

/** Builds the canonical export projection without changing approved claim text or evidence. */
export function buildResumeRenderModel(
    resume: Pick<FinalResumePackage, 'claims' | 'summaryPresentation'>,
    sourceStructure?: CanonicalResumeStructure,
): ResumeRenderModel {
    const claims = resume.claims.filter((claim) => !isSectionHeading(claim.text));
    const contactClaims = claims.filter((claim) => claim.section === 'contact');
    const otherClaims = claims.filter((claim) => claim.section === 'other');
    const nameClaim = otherClaims.find((claim) => looksLikeName(claim.text));
    const combinedIdentityClaim = otherClaims.find((claim) =>
        /^.+\s+[—-]\s+.+$/.test(claim.text.trim()),
    );
    const headlineClaim = nameClaim
        ? otherClaims.find(
            (claim) =>
                claim.id !== nameClaim.id &&
                claim.text.trim().length <= 100 &&
                !/[.!?]$/.test(claim.text.trim()),
        )
        : undefined;
    const identityClaimIds = new Set(
        [nameClaim?.id, headlineClaim?.id, combinedIdentityClaim?.id].filter(
            (id): id is string => Boolean(id),
        ),
    );
    const bySourceFactId = new Map(
        claims.flatMap((claim) =>
            claim.evidence.map((reference) => [reference.sourceFactId, claim] as const),
        ),
    );
    const itemForSource = (factId: string): ResumeRenderItem | undefined => {
        const claim = bySourceFactId.get(factId);
        return claim ? renderItem(claim) : undefined;
    };
    const groupedExperience = (() => {
        if (!sourceStructure?.experienceEntries) return undefined;

        // A writer may consolidate adjacent source facts into one claim. Prefer
        // that claim as an entry heading rather than also rendering it as a
        // preceding entry's achievement.
        const headingItemIds = new Set(
            sourceStructure.experienceEntries
                .map((entry) =>
                    entry.headingFactId
                        ? itemForSource(entry.headingFactId)?.id
                        : undefined,
                )
                .filter((id): id is string => Boolean(id)),
        );
        const renderedItemIds = new Set<string>();

        return sourceStructure.experienceEntries
            .map((entry, index) => {
                const heading = entry.headingFactId
                    ? itemForSource(entry.headingFactId)
                    : undefined;
                if (heading) renderedItemIds.add(heading.id);
                const achievements = entry.itemFactIds
                    .map(itemForSource)
                    .filter((item): item is ResumeRenderItem => Boolean(item))
                    .filter(
                        (item) =>
                            !headingItemIds.has(item.id) &&
                            !renderedItemIds.has(item.id),
                    );
                achievements.forEach((item) => renderedItemIds.add(item.id));
                return {
                    id: entry.id || `experience-${index + 1}`,
                    ...(heading ? { heading } : {}),
                    achievements,
                };
            })
            .filter((entry) => entry.heading || entry.achievements.length > 0);
    })();
    const experienceClaims = claims.filter((claim) => claim.section === 'experience');
    const experience: ResumeRenderExperienceEntry[] = [];
    let current: ResumeRenderExperienceEntry | undefined;
    for (const claim of experienceClaims) {
        if (!current || looksLikeExperienceHeading(claim.text)) {
            current = {
                id: `experience-${experience.length + 1}`,
                ...(looksLikeExperienceHeading(claim.text)
                    ? { heading: renderItem(claim) }
                    : {}),
                achievements: looksLikeExperienceHeading(claim.text)
                    ? []
                    : [renderItem(claim)],
            };
            experience.push(current);
        } else {
            const updated = {
                ...current,
                achievements: [...current.achievements, renderItem(claim)],
            };
            experience[experience.length - 1] = updated;
            current = updated;
        }
    }

    const groupedItems = (groups: readonly CanonicalResumeGroup[] | undefined) =>
        groups
            ?.flatMap((group) => group.itemFactIds)
            .map(itemForSource)
            .filter((item): item is ResumeRenderItem => Boolean(item));
    const sourceIdentity = sourceStructure?.identity;

    return {
        schemaVersion: '1',
        identity: {
            ...(sourceIdentity?.nameFactId && itemForSource(sourceIdentity.nameFactId)
                ? { name: itemForSource(sourceIdentity.nameFactId) }
                : nameClaim
                    ? { name: renderItem(nameClaim) }
                    : {}),
            ...(sourceIdentity?.headlineFactId && itemForSource(sourceIdentity.headlineFactId)
                ? { headline: itemForSource(sourceIdentity.headlineFactId) }
                : headlineClaim
                    ? { headline: renderItem(headlineClaim) }
                    : {}),
            contactLines:
                sourceIdentity?.contactFactIds
                    .map(itemForSource)
                    .filter((item): item is ResumeRenderItem => Boolean(item)) ??
                contactClaims.map(renderItem),
        },
        summary: claims
            .filter((claim) => claim.section === 'summary')
            .map(renderItem),
        summaryPresentation: resume.summaryPresentation ?? 'paragraph',
        skills:
            groupedItems(sourceStructure?.skillGroups) ??
            claims.filter((claim) => claim.section === 'skills').map(renderItem),
        experience: groupedExperience?.length ? groupedExperience : experience,
        education:
            groupedItems(sourceStructure?.educationEntries) ??
            claims.filter((claim) => claim.section === 'education').map(renderItem),
        certifications:
            sourceStructure?.certificationFactIds
                .map(itemForSource)
                .filter((item): item is ResumeRenderItem => Boolean(item)) ??
            claims.filter((claim) => claim.section === 'certifications').map(renderItem),
        additionalInformation: otherClaims
            .filter((claim) => !identityClaimIds.has(claim.id))
            .map(renderItem),
    };
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
    version?: ResumeVersionMetadata;
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
        (value.summaryPresentation === undefined ||
            value.summaryPresentation === 'paragraph' ||
            value.summaryPresentation === 'bullets') &&
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
        (value.renderModel === undefined || isResumeRenderModel(value.renderModel)) &&
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
