'use client';

import { FormEvent, useMemo, useState } from 'react';

type Evidence = { sourceFactId: string; sourceSegmentId: string };
type ResumeSection = 'contact' | 'summary' | 'skills' | 'experience' | 'education' | 'certifications' | 'other';
type Claim = { id: string; text: string; section: ResumeSection; evidence: Evidence[] };
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
type WorkflowStage = 'upload' | 'profile' | 'tailor' | 'review' | 'export';
type ReviewPanel = 'evidence' | 'gaps' | 'draft' | 'quality' | 'final' | 'decisions' | 'changes';

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
    const [reusedProfile, setReusedProfile] = useState(false);
    const [versionType, setVersionType] = useState<ResumeVersion['versionType']>('job-specific');
    const [versionTrack, setVersionTrack] = useState('');
    const [stage, setStage] = useState<WorkflowStage>('upload');
    const [baseResumeLabel, setBaseResumeLabel] = useState('No base resume selected');
    const [expandedSections, setExpandedSections] = useState<Record<ResumeSection, boolean>>({
        contact: true, summary: true, skills: true, experience: true, education: true, certifications: true, other: true,
    });
    const [expandedReviewPanels, setExpandedReviewPanels] = useState<Record<ReviewPanel, boolean>>({
        evidence: true, gaps: false, draft: false, quality: true, final: true, decisions: false, changes: false,
    });
    const claimsBySection = useMemo(() => {
        const sections: ResumeSection[] = ['contact', 'summary', 'skills', 'experience', 'education', 'certifications', 'other'];
        return sections.map((section) => ({ section, claims: claims.filter((claim) => claim.section === section) })).filter((group) => group.claims.length > 0);
    }, [claims]);

    async function upload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement;
        if (!input.files?.[0]) return;
        setUploading(true); setError(''); setProfile(null); setRun(null); setReusedProfile(false); setBaseResumeLabel(input.files[0].name);
        const body = new FormData(); body.append('file', input.files[0]);
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/resumes/upload`, { method: 'POST', body }));
            setProfile(result); setClaims(result.claims); setReusedProfile(Boolean(result.reused)); setStage('profile');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed.'); }
        finally { setUploading(false); }
    }

    function updateClaim(id: string, text: string) { setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, text } : claim)); }
    function updateClaimSection(id: string, section: ResumeSection) { setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, section } : claim)); }
    function removeClaim(id: string) { setClaims((current) => current.filter((claim) => claim.id !== id)); }
    function reviewAccordion(panel: ReviewPanel, title: string, detail: string, content: React.ReactNode) {
        return <section className="review-accordion">
            <button className="accordion-trigger" type="button" aria-expanded={expandedReviewPanels[panel]} onClick={() => setExpandedReviewPanels((current) => ({ ...current, [panel]: !current[panel] }))}>
                <span><b>{title}</b><small>{detail}</small></span><span aria-hidden="true">{expandedReviewPanels[panel] ? '−' : '+'}</span>
            </button>
            {expandedReviewPanels[panel] && <div className="review-accordion-content">{content}</div>}
        </section>;
    }

    async function approve() {
        if (!profile) return;
        setApproving(true); setError('');
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/resumes/${profile.resumeId}/approve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claims: claims.map(({ id, text, section }) => ({ id, text, section })) }),
            }));
            setProfile(result); setClaims(result.claims); setStage('tailor');
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
            setRun(result); setStage('review');
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
            setRun(result); setStage('export');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Final content approval failed.'); }
        finally { setApprovingFinal(false); }
    }

    async function generateVersion() {
        if (!run || run.version) return;
        setGenerating(true); setError('');
        try {
            const result = await parseResponse(await fetch(`${apiUrl}/api/tailoring-runs/${run.runId}/versions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionType, track: versionType === 'targeted' ? versionTrack.trim() || undefined : undefined }),
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
            setProfile(result); setClaims(result.claims); setBaseResumeLabel(`Saved profile ${result.resumeId}`); setStage(result.status === 'approved' ? 'tailor' : 'profile');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not select the saved version.'); }
    }

    return <main>
        <header className="hero">
            <p className="eyebrow">Resume Tweak · evidence-grounded tailoring</p>
            <h1>Tailor the story,<br />not the facts.</h1>
            <p className="intro">Review the factual record, then compare it with a job description. Missing requirements are shown as gaps and are never added to the draft.</p>
        </header>
        <nav className="workflow" aria-label="Resume workflow">
            {([
                ['upload', 'Upload', true],
                ['profile', 'Fact review', Boolean(profile)],
                ['tailor', 'Tailor', profile?.status === 'approved'],
                ['review', 'Review', Boolean(run)],
                ['export', 'Export', run?.approvalStatus === 'approved'],
            ] as const).map(([value, label, enabled], index) => <button className={stage === value ? 'workflow-current' : ''} disabled={!enabled} onClick={() => setStage(value)} type="button" key={value}><b>{index + 1}</b>{label}</button>)}
        </nav>
        {profile && <aside className="base-resume-bar" aria-label="Current base resume"><span>Current base resume</span><strong>{baseResumeLabel}</strong><small>{profile.resumeId} · {profile.status}</small><button type="button" onClick={() => setStage('profile')}>View factual profile</button></aside>}
        {stage === 'upload' && <form className="upload-form" onSubmit={upload}>
            <label htmlFor="file">Base resume (.docx or text-based .pdf)</label>
            <input id="file" name="file" type="file" accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" required />
            <p className="review-help">PDFs must contain selectable text. Scanned, image-only, encrypted, and corrupt PDFs are not supported.</p>
            <button type="submit" disabled={uploading}>{uploading ? 'Extracting…' : 'Extract profile'}</button>
        </form>}
        {error && <p className="error" role="alert">{error}</p>}
        {reusedProfile && profile && <aside className="cache-notice" aria-live="polite"><strong>Existing profile reused.</strong> This exact source file matches your saved {profile.status} factual profile. {profile.status === 'draft' ? 'Continue the existing factual review.' : 'You can tailor from the approved record without extracting it again.'}</aside>}
        {profile && stage === 'profile' && <section className="review" aria-label="Extracted resume profile">
            <div className="review-heading"><div><p className="eyebrow">Factual profile</p><h2>{profile.claims.length} source-backed claims</h2></div><span className="status"><span className="status-dot" />{profile.status === 'approved' ? 'Approved factual profile' : 'Needs your review'}</span></div>
            <p className="review-help">Correct wording, section, or remove claims before approval. Kept claims remain tied to original source evidence.</p>
            <div className="claim-accordions">
                {claimsBySection.map(({ section, claims: sectionClaims }) => <section className="claim-accordion" key={section}>
                    <button className="accordion-trigger" type="button" aria-expanded={expandedSections[section]} onClick={() => setExpandedSections((current) => ({ ...current, [section]: !current[section] }))}>
                        <span><b>{section}</b><small>{sectionClaims.length} {sectionClaims.length === 1 ? 'claim' : 'claims'}</small></span><span aria-hidden="true">{expandedSections[section] ? '−' : '+'}</span>
                    </button>
                    {expandedSections[section] && <ol>{sectionClaims.map((claim) => <li key={claim.id}><div className="claim-meta"><strong>{claim.id}</strong><small>Evidence: {claim.evidence[0]?.sourceSegmentId}</small></div>{profile.status === 'draft' ? <label className="claim-section">Section<select value={claim.section} onChange={(event) => updateClaimSection(claim.id, event.target.value as ResumeSection)}>{(['contact', 'summary', 'skills', 'experience', 'education', 'certifications', 'other'] as const).map((option) => <option key={option} value={option}>{option}</option>)}</select></label> : <small>{claim.section}</small>}<textarea aria-label={`Claim ${claim.id}`} value={claim.text} onChange={(event) => updateClaim(claim.id, event.target.value)} disabled={profile.status === 'approved'} />{profile.status === 'draft' && <button className="remove-claim" type="button" onClick={() => removeClaim(claim.id)}>Remove claim</button>}</li>)}</ol>}
                </section>)}
            </div>
            {profile.status === 'draft' && <button className="approve-button" type="button" onClick={approve} disabled={approving || claims.length === 0}>{approving ? 'Saving approval…' : 'Approve factual profile and continue'}</button>}
            {profile.status === 'approved' && <button className="approve-button" type="button" onClick={() => setStage('tailor')}>Continue to tailoring</button>}
        </section>}
        {profile?.status === 'approved' && stage === 'tailor' && <section className="tailoring" aria-label="Tailoring run">
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
        {run && (stage === 'review' || stage === 'export') && <section className="results" aria-live="polite">
            {run.status === 'failed' ? <><h2>Tailoring run could not complete</h2><p className="error">{run.error}</p></> : <>
                <div className="result-heading"><div><p className="eyebrow">Draft review</p><h2>{run.jobProfile?.targetRole ?? 'Tailored resume'}</h2></div><small>Model: {run.modelProfileId} / {run.deployment}</small></div>
                {run.jobProfile?.seniority && <p className="review-help">Target seniority: {run.jobProfile.seniority}</p>}
                <div className="review-accordions">
                    {reviewAccordion('evidence', 'Requirement-to-evidence map', `${run.evidenceMatrix?.rows.length ?? 0} requirements`, <div className="matrix">{run.evidenceMatrix?.rows.map((row) => <article className={`matrix-row ${row.strength === 'none' ? 'gap-row' : ''}`} key={row.requirementId}><strong>{row.requirement}</strong><span>{row.strength} · {row.action}</span><small>{row.evidence.length ? row.evidence.map((item) => item.sourceFactId).join(', ') : 'No approved evidence'}</small></article>)}</div>)}
                    {run.gaps.length > 0 && reviewAccordion('gaps', 'Unmatched requirements', `${run.gaps.length} gaps kept outside the resume`, <aside className="gaps"><p>These requirements have no approved evidence and were not added to the resume.</p><ul>{run.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></aside>)}
                    {reviewAccordion('draft', 'Tailored draft preview', `${run.tailoredDraft?.claims.length ?? 0} claims`, <>{run.tailoredDraft?.summary && <p className="draft-summary">{run.tailoredDraft.summary}</p>}<ol className="draft-claims">{run.tailoredDraft?.claims.map((claim) => <li key={claim.id}><span>{claim.section}</span>{claim.text}<small>Evidence: {claim.evidence.map((item) => item.sourceFactId).join(', ')}</small></li>)}</ol></>)}
                </div>
                {run.reviewStatus === 'failed' && <p className="error">Quality review could not complete: {run.reviewError}</p>}
                {run.reviewStatus === 'completed' && run.finalResume && <>
                    <div className="review-accordions">
                        {reviewAccordion('quality', 'Quality review', `${(run.atsReview?.findings.length ?? 0) + (run.readabilityReview?.findings.length ?? 0)} findings`, <div className="review-reports">
                            {[run.atsReview, run.readabilityReview].filter((report): report is ReviewReport => Boolean(report)).map((report) => <article className="review-report" key={report.reviewer}><h4>{report.reviewer === 'ats' ? 'ATS compatibility' : 'Recruiter readability'}</h4>{report.findings.length === 0 ? <p>No findings.</p> : <ol>{report.findings.map((finding) => <li key={finding.id} className={`finding finding-${finding.severity}`}><strong>{finding.severity}</strong><span>{finding.message}</span><small>Recommendation: {finding.recommendation}</small></li>)}</ol>}</article>)}
                        </div>)}
                        {reviewAccordion('final', 'Final reviewed content', `${run.finalResume.claims.length} approved claims`, <>{run.finalResume.summary && <p className="draft-summary">{run.finalResume.summary}</p>}<ol className="draft-claims">{run.finalResume.claims.map((claim) => <li key={claim.id}><span>{claim.section}</span>{claim.text}<small>Evidence: {claim.evidence.map((item) => item.sourceFactId).join(', ')}</small></li>)}</ol>{run.finalResume.unresolvedGaps.length > 0 && <aside className="gaps"><p>Unresolved gaps remain outside the resume.</p><ul>{run.finalResume.unresolvedGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></aside>}</>)}
                        {reviewAccordion('decisions', 'Recommendation decisions', `${run.finalResume.decisions.length} decisions`, <div className="decision-list">{run.finalResume.decisions.map((decision) => <article key={decision.findingId}><strong>{decision.decision}</strong><span>{decision.rationale}</span></article>)}</div>)}
                        {reviewAccordion('changes', 'Change log', `${run.finalResume.changeLog.length} changes`, <ul className="change-log">{run.finalResume.changeLog.map((change) => <li key={change}>{change}</li>)}</ul>)}
                    </div>
                    {stage === 'review' && run.approvalStatus !== 'approved' && <><button className="approve-button" type="button" onClick={approveFinalContent} disabled={approvingFinal}>{approvingFinal ? 'Saving final approval…' : 'Approve final content and continue'}</button><p className="review-help">Approval is required before DOCX/PDF files are generated or saved as versions.</p></>}
                    {stage === 'export' && run.approvalStatus === 'approved' && <>{run.version ? <section className="export-panel"><h3>Downloads ready</h3><p className="approval-confirmation">Approved content was saved as a {run.version.versionType} version.</p><div className="download-links"><a href={`${apiUrl}/api/resume-versions/${run.version.versionId}/download/docx`}>Download DOCX</a><a href={`${apiUrl}/api/resume-versions/${run.version.versionId}/download/pdf`}>Download PDF</a></div></section> : <section className="export-panel"><p className="approval-confirmation">Final content approved {run.approvedAt ? `on ${new Date(run.approvedAt).toLocaleString()}` : ''}.</p><div className="version-options"><label>Save as<select value={versionType} onChange={(event) => setVersionType(event.target.value as ResumeVersion['versionType'])}><option value="general">General</option><option value="targeted">Targeted</option><option value="job-specific">Job-specific</option></select></label>{versionType === 'targeted' && <label>Track<input value={versionTrack} onChange={(event) => setVersionTrack(event.target.value)} placeholder="Example: Platform engineering" /></label>}</div><button className="approve-button" type="button" onClick={generateVersion} disabled={generating || (versionType === 'targeted' && !versionTrack.trim())}>{generating ? 'Generating DOCX and PDF…' : 'Generate DOCX and PDF'}</button><p className="review-help">Exports use an ATS-safe single-column DOCX, then verify the matching PDF text.</p></section>}</>}
                </>}
            </>}
        </section>}
        <section className="versions" aria-label="Saved resume versions"><div className="review-heading"><div><p className="eyebrow">Reusable versions</p><h2>General, targeted, and job-specific exports</h2></div><button type="button" onClick={loadVersions}>Refresh versions</button></div>{versions.length > 0 && <ol className="version-list">{versions.map((version) => <li key={version.versionId}><div><strong>{version.targetRole}</strong><small>{version.versionType}{version.track ? ` · ${version.track}` : ''} · {new Date(version.createdAt).toLocaleDateString()}</small></div><div className="download-links"><button type="button" onClick={() => selectVersion(version.versionId)}>Use as source</button><a href={`${apiUrl}/api/resume-versions/${version.versionId}/download/docx`}>DOCX</a><a href={`${apiUrl}/api/resume-versions/${version.versionId}/download/pdf`}>PDF</a></div></li>)}</ol>}{versions.length === 0 && <p className="review-help">Generate an approved export, then refresh this list to reuse it in later tailoring work.</p>}</section>
    </main>;
}
