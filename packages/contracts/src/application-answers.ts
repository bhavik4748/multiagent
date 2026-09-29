/** Application answers are transient and never change the canonical profile. */
export interface AnswerLimit { unit: 'words' | 'characters'; value: number }
export interface ApplicationQuestion {
    id: string;
    question: string;
    factualNotes?: string;
    limit?: AnswerLimit;
}
export interface ApplicationAnswersRequest {
    questions: ApplicationQuestion[];
    jobDescription?: string;
}
export interface AnswerEvidence {
    sourceFactId: string;
    sourceSegmentId: string;
    quote: string;
}
export interface AnswerNoteReference { questionId: string; quote: string }
export interface AnswerStatement {
    id: string;
    text: string;
    evidence: AnswerEvidence[];
    noteReferences: AnswerNoteReference[];
}
export interface ApplicationAnswerDraft {
    questionId: string;
    status: 'answered' | 'partial' | 'needs-user-input';
    statements: AnswerStatement[];
    missingInformation: string[];
}
export interface ApplicationAnswer extends Omit<ApplicationAnswerDraft, 'status'> {
    status: ApplicationAnswerDraft['status'] | 'failed';
    answerText: string;
    error?: string;
}
export interface ApplicationAnswersResponse {
    resumeId: string;
    modelProfileId: string;
    deployment: string;
    answers: ApplicationAnswer[];
}
export function answerCounts(text: string) {
    return { words: text.trim() ? text.trim().split(/\s+/u).length : 0, characters: Array.from(text).length };
}
export function answerWithinLimit(text: string, limit?: AnswerLimit): boolean {
    const counts = answerCounts(text);
    return counts.words <= 500 && counts.characters <= 3000 && (!limit || counts[limit.unit] <= limit.value);
}

const stringSchema = { type: 'string' };
const objectSchema = (properties: Record<string, unknown>) => ({
    type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const arraySchema = (items: unknown) => ({ type: 'array', items });
export const applicationAnswerDraftSchema = objectSchema({
    questionId: stringSchema,
    status: { type: 'string', enum: ['answered', 'partial', 'needs-user-input'] },
    statements: arraySchema(objectSchema({
        id: stringSchema, text: stringSchema,
        evidence: arraySchema(objectSchema({ sourceFactId: stringSchema, sourceSegmentId: stringSchema, quote: stringSchema })),
        noteReferences: arraySchema(objectSchema({ questionId: stringSchema, quote: stringSchema })),
    })),
    missingInformation: arraySchema(stringSchema),
});
export interface AnswerSupportReview {
    statements: { statementId: string; supported: boolean }[];
    conflicts: string[];
    missingInformation: string[];
}
export const answerSupportReviewSchema = objectSchema({
    statements: arraySchema(objectSchema({ statementId: stringSchema, supported: { type: 'boolean' } })),
    conflicts: arraySchema(stringSchema), missingInformation: arraySchema(stringSchema),
});
function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonblank);
function statement(value: unknown): value is AnswerStatement {
    return record(value) && nonblank(value.id) && nonblank(value.text) &&
        Array.isArray(value.evidence) && value.evidence.every((e: unknown) => record(e) && nonblank(e.sourceFactId) && nonblank(e.sourceSegmentId) && nonblank(e.quote)) &&
        Array.isArray(value.noteReferences) && value.noteReferences.every((n: unknown) => record(n) && nonblank(n.questionId) && nonblank(n.quote));
}
export function isApplicationAnswerDraft(value: unknown): value is ApplicationAnswerDraft {
    return record(value) && nonblank(value.questionId) && ['answered', 'partial', 'needs-user-input'].includes(String(value.status)) &&
        Array.isArray(value.statements) && value.statements.length <= 30 && value.statements.every(statement) &&
        strings(value.missingInformation) && value.missingInformation.length <= 20;
}
export function isAnswerSupportReview(value: unknown): value is AnswerSupportReview {
    return record(value) && Array.isArray(value.statements) && value.statements.every((s: unknown) => record(s) && nonblank(s.statementId) && typeof s.supported === 'boolean') && strings(value.conflicts) && strings(value.missingInformation);
}