'use client';

import { FormEvent, useState } from 'react';

type Evidence = { sourceFactId: string; sourceSegmentId: string };
type Claim = { id: string; text: string; section: string; evidence: Evidence[] };
type Profile = { resumeId: string; claims: Claim[]; status: 'draft' | 'approved' };
type MatrixRow = { requirementId: string; requirement: string; strength: 'strong' | 'partial' | 'none'; action: string; evidence: Evidence[] };
type TailoringRun = {
    status: 'completed' | 'failed'; deployment: string; modelProfileId: string; gaps: string[]; error?: string;
    jobProfile?: { targetRole: string; seniority?: string };
    evidenceMatrix?: { rows: MatrixRow[] };
    tailoredDraft?: { summary?: string; claims: Claim[] };
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

    return <main>
        <p className="eyebrow">Phase 2 / Evidence-grounded tailoring</p>
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
                <p className="review-help">This is a Phase 2 review draft. Approval, document generation, and downloads follow in later phases.</p>
            </>}
        </section>}
    </main>;
}
