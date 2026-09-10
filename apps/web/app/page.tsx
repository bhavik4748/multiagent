'use client';

import { FormEvent, useState } from 'react';

type Evidence = { sourceFactId: string; sourceSegmentId: string };
type Claim = { id: string; text: string; section: string; evidence: Evidence[] };
type Profile = { resumeId: string; claims: Claim[]; status: 'draft' | 'approved' };
type MatrixRow = { requirementId: string; requirement: string; strength: 'strong' | 'partial' | 'none'; action: string; evidence: Evidence[] };
type ReviewFinding = { id: string; reviewer: 'ats' | 'readability'; severity: 'high' | 'medium' | 'low'; message: string; recommendation: string; affectedClaimIds: string[] };
type ReviewReport = { reviewer: 'ats' | 'readability'; findings: ReviewFinding[] };
type FinalResume = { summary?: string; claims: Claim[]; unresolvedGaps: string[]; decisions: { findingId: string; decision: 'accepted' | 'rejected' | 'unresolved'; rationale: string; affectedClaimIds: string[] }[]; changeLog: string[] };
type TailoringRun = {
    runId: string; status: 'completed' | 'failed'; deployment: string; modelProfileId: string; gaps: string[]; error?: string;
    jobProfile?: { targetRole: string; seniority?: string };
    evidenceMatrix?: { rows: MatrixRow[] };
    tailoredDraft?: { summary?: string; claims: Claim[] };
    atsReview?: ReviewReport;
    readabilityReview?: ReviewReport;
    finalResume?: FinalResume;
    reviewStatus: 'not-started' | 'completed' | 'failed';
    reviewError?: string;
    approvalStatus: 'pending' | 'approved';
    approvedAt?: string;
    version?: ResumeVersion;
};

type ResumeVersion = {
    versionId: string; versionType: 'general' | 'targeted' | 'job-specific'; track?: string; targetRole: string; createdAt: string;
    artifacts: { docxPath: string; pdfPath: string }; unresolvedGaps: string[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

async function parseResponse(response: Response) {
    const data = await response.json();
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message ?? 'Request failed.');
    return data;
}

export default function HomePage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [claims, setClaims] = useState<Claim[]>([]);
    const [jobDescription, setJobDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [run, setRun] = useState<TailoringRun | null>(null);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [approving, setApproving] = useState(false);
    const [tailoring, setTailoring] = useState(false);
    const [approvingFinal, setApprovingFinal] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [versions, setVersions] = useState<ResumeVersion[]>([]);

    async function upload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement;
        if (!input.files?.[0]) return;
        setUploading(true); setError(''); setProfile(null); setRun(null);
        const body = new FormData(); body.append('file', input.files[0]);
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/resumes/upload`, { method: 'POST', body }));
            setProfile(result); setClaims(result.claims);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed.'); }
        finally { setUploading(false); }
    }

    function updateClaim(id: string, text: string) { setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, text } : claim)); }
    function removeClaim(id: string) { setClaims((current) => current.filter((claim) => claim.id !== id)); }

    async function approve() {
        if (!profile) return;
        setApproving(true); setError('');
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/resumes/${profile.resumeId}/approve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claims: claims.map(({ id, text }) => ({ id, text })) }),
            }));
            setProfile(result); setClaims(result.claims);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Approval failed.'); }
        finally { setApproving(false); }
    }

    async function tailor(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!profile) return;
        setTailoring(true); setError(''); setRun(null);
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/resumes/${profile.resumeId}/tailoring-runs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobDescription, additionalInstructions: instructions || undefined }),
            }));
            setRun(result);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Tailoring failed.'); }
        finally { setTailoring(false); }
    }

    async function approveFinalContent() {
        if (!run?.finalResume || run.approvalStatus === 'approved') return;
        setApprovingFinal(true); setError('');
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/tailoring-runs/${run.runId}/approve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
            }));
            setRun(result);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Final content approval failed.'); }
        finally { setApprovingFinal(false); }
    }

    async function generateVersion() {
        if (!run || run.version) return;
        setGenerating(true); setError('');
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/tailoring-runs/${run.runId}/versions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionType: 'job-specific' }),
            }));
            setRun(result); setVersions((current) => result.version ? [result.version, ...current.filter((version) => version.versionId !== result.version.versionId)] : current);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Document generation failed.'); }
        finally { setGenerating(false); }
    }

    async function loadVersions() {
        setError('');
        try { setVersions(await parseResponse(await fetch(`${apiUrl}/api/resume-versions`))); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load saved versions.'); }
    }

    async function selectVersion(versionId: string) {
        setError(''); setRun(null);
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/resume-versions/${versionId}/source-profile`));
            setProfile(result); setClaims(result.claims);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not select the saved version.'); }
    }

    return <main>
        <p className="eyebrow">Phase 4 / Evidence-grounded document export</p>
        <h1>Tailor the story, not the facts.</h1>
        <p className="intro">Review the factual record, then compare it with a job description. Missing requirements are shown as gaps and are never added to the draft.</p>
        <form className="upload-form" onSubmit={upload}>
            <label htmlFor="file">Base resume (.docx)</label>
            <input id="file" name="file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
            <button type="submit" disabled={uploading}>{uploading ? 'Extracting…' : 'Extract profile'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {profile && <section className="review" aria-label="Extracted resume profile">
            <div className="review-heading"><div><p className="eyebrow">Factual profile</p><h2>{profile.claims.length} source-backed claims</h2></div><span className="status"><span className="status-dot" />{profile.status === 'approved' ? 'Approved factual profile' : 'Needs your review'}</span></div>
            <p className="review-help">Correct wording or remove claims before approval. Kept claims remain tied to original source evidence.</p>
            <ol>{claims.map((claim) => <li key={claim.id}><div className="claim-meta"><strong>{claim.id}</strong><small>{claim.section} · Evidence: {claim.evidence[0]?.sourceSegmentId}</small></div><textarea aria-label={`Claim ${claim.id}`} value={claim.text} onChange={(event) => updateClaim(claim.id, event.target.value)} disabled={profile.status === 'approved'} />{profile.status === 'draft' && <button className="remove-claim" type="button" onClick={() => removeClaim(claim.id)}>Remove claim</button>}</li>)}</ol>
            {profile.status === 'draft' && <button className="approve-button" type="button" onClick={approve} disabled={approving || claims.length === 0}>{approving ? 'Saving approval…' : 'Approve factual profile'}</button>}
        </section>}
        {profile?.status === 'approved' && <section className="tailoring" aria-label="Tailoring run">
            <p className="eyebrow">Tailoring request</p><h2>Match this approved profile to a role.</h2>
            <form className="tailoring-form" onSubmit={tailor}>
                <label htmlFor="job-description">Job description <small>{jobDescription.length}/20,000</small></label>
                <textarea id="job-description" value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} minLength={40} maxLength={20000} required />
                <label htmlFor="instructions">Additional context / special instructions <small>optional · {instructions.length}/2,000</small></label>
                <textarea id="instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} placeholder="Example: Prioritize backend and cloud experience. Keep this concise." />
                <p className="review-help">Instructions control emphasis, tone, or length. They cannot add unverified experience, skills, credentials, dates, or outcomes.</p>
                <button className="approve-button" type="submit" disabled={tailoring}>{tailoring ? 'Creating evidence-grounded draft…' : 'Create tailored draft'}</button>
            </form>
        </section>}
        {run && <section className="results" aria-live="polite">
            {run.status === 'failed' ? <><h2>Tailoring run could not complete</h2><p className="error">{run.error}</p></> : <>
                <div className="result-heading"><div><p className="eyebrow">Draft review</p><h2>{run.jobProfile?.targetRole ?? 'Tailored resume'}</h2></div><small>Model: {run.modelProfileId} / {run.deployment}</small></div>
                {run.jobProfile?.seniority && <p className="review-help">Target seniority: {run.jobProfile.seniority}</p>}
                <h3>Requirement-to-evidence map</h3><div className="matrix">{run.evidenceMatrix?.rows.map((row) => <article className={`matrix-row ${row.strength === 'none' ? 'gap-row' : ''}`} key={row.requirementId}><strong>{row.requirement}</strong><span>{row.strength} · {row.action}</span><small>{row.evidence.length ? row.evidence.map((item) => item.sourceFactId).join(', ') : 'No approved evidence'}</small></article>)}</div>
                {run.gaps.length > 0 && <aside className="gaps"><h3>Unmatched requirements</h3><p>These requirements have no approved evidence and were not added to the resume.</p><ul>{run.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></aside>}
                <h3>Tailored draft preview</h3>{run.tailoredDraft?.summary && <p className="draft-summary">{run.tailoredDraft.summary}</p>}<ol className="draft-claims">{run.tailoredDraft?.claims.map((claim) => <li key={claim.id}><span>{claim.section}</span>{claim.text}<small>Evidence: {claim.evidence.map((item) => item.sourceFactId).join(', ')}</small></li>)}</ol>
                {run.reviewStatus === 'failed' && <p className="error">Quality review could not complete: {run.reviewError}</p>}
                {run.reviewStatus === 'completed' && run.finalResume && <>
                    <h3>Quality review</h3>
                    <div className="review-reports">
                        {[run.atsReview, run.readabilityReview].filter((report): report is ReviewReport => Boolean(report)).map((report) => <article className="review-report" key={report.reviewer}><h4>{report.reviewer === 'ats' ? 'ATS compatibility' : 'Recruiter readability'}</h4>{report.findings.length === 0 ? <p>No findings.</p> : <ol>{report.findings.map((finding) => <li key={finding.id} className={`finding finding-${finding.severity}`}><strong>{finding.severity}</strong><span>{finding.message}</span><small>Recommendation: {finding.recommendation}</small></li>)}</ol>}</article>)}
                    </div>
                    <h3>Final reviewed content</h3>{run.finalResume.summary && <p className="draft-summary">{run.finalResume.summary}</p>}<ol className="draft-claims">{run.finalResume.claims.map((claim) => <li key={claim.id}><span>{claim.section}</span>{claim.text}<small>Evidence: {claim.evidence.map((item) => item.sourceFactId).join(', ')}</small></li>)}</ol>
                    <h3>Recommendation decisions</h3><div className="decision-list">{run.finalResume.decisions.map((decision) => <article key={decision.findingId}><strong>{decision.decision}</strong><span>{decision.rationale}</span></article>)}</div>
                    <h3>Change log</h3><ul className="change-log">{run.finalResume.changeLog.map((change) => <li key={change}>{change}</li>)}</ul>
                    {run.finalResume.unresolvedGaps.length > 0 && <aside className="gaps"><h3>Unresolved gaps remain outside the resume</h3><ul>{run.finalResume.unresolvedGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></aside>}
                    {run.approvalStatus === 'approved' ? <>{run.version ? <section className="export-panel"><h3>Downloads ready</h3><p className="approval-confirmation">Approved content was saved as a {run.version.versionType} version.</p><div className="download-links"><a href={`${apiUrl}/api/resume-versions/${run.version.versionId}/download/docx`}>Download DOCX</a><a href={`${apiUrl}/api/resume-versions/${run.version.versionId}/download/pdf`}>Download PDF</a></div></section> : <section className="export-panel"><p className="approval-confirmation">Final content approved {run.approvedAt ? `on ${new Date(run.approvedAt).toLocaleString()}` : ''}.</p><button className="approve-button" type="button" onClick={generateVersion} disabled={generating}>{generating ? 'Generating DOCX and PDF…' : 'Generate DOCX and PDF'}</button><p className="review-help">Exports use an ATS-safe single-column DOCX, then verify the matching PDF text.</p></section>}</> : <><button className="approve-button" type="button" onClick={approveFinalContent} disabled={approvingFinal}>{approvingFinal ? 'Saving final approval…' : 'Approve final content'}</button><p className="review-help">Approval is required before DOCX/PDF files are generated or saved as versions.</p></>}
                </>}
            </>}
        </section>}
        <section className="versions" aria-label="Saved resume versions"><div className="review-heading"><div><p className="eyebrow">Reusable versions</p><h2>General, targeted, and job-specific exports</h2></div><button type="button" onClick={loadVersions}>Refresh versions</button></div>{versions.length > 0 && <ol className="version-list">{versions.map((version) => <li key={version.versionId}><div><strong>{version.targetRole}</strong><small>{version.versionType}{version.track ? ` · ${version.track}` : ''} · {new Date(version.createdAt).toLocaleDateString()}</small></div><div className="download-links"><button type="button" onClick={() => selectVersion(version.versionId)}>Use as source</button><a href={`${apiUrl}/api/resume-versions/${version.versionId}/download/docx`}>DOCX</a><a href={`${apiUrl}/api/resume-versions/${version.versionId}/download/pdf`}>PDF</a></div></li>)}</ol>}{versions.length === 0 && <p className="review-help">Generate an approved export, then refresh this list to reuse it in later tailoring work.</p>}</section>
    </main>;
}
