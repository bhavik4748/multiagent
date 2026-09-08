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
}

export interface CanonicalResumeProfile {
    resumeId: string;
    claims: readonly ResumeClaim[];
}

export interface FinalResumePackage {
    resumeId: string;
    claims: readonly ResumeClaim[];
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
