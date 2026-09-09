'use client';

import { FormEvent, useState } from 'react';

type Claim = { id: string; text: string; section: string; evidence: { sourceSegmentId: string }[] };
type Profile = {
    resumeId: string;
    claims: Claim[];
    sourceSegments: { id: string; text: string; sequence: number }[];
    status: 'draft' | 'approved';
    approvedAt?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function HomePage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [claims, setClaims] = useState<Claim[]>([]);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [approving, setApproving] = useState(false);

    async function upload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement;
        if (!input.files?.[0]) return;
        setUploading(true);
        setError('');
        setProfile(null);
        const body = new FormData();
        body.append('file', input.files[0]);
        try {
            const response = await fetch(`${apiUrl}/api/resumes/upload`, { method: 'POST', body });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message ?? 'Upload failed.');
            setProfile(result);
            setClaims(result.claims);
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
        } finally {
            setUploading(false);
        }
    }

    function updateClaim(id: string, text: string) {
        setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, text } : claim));
    }

    function removeClaim(id: string) {
        setClaims((current) => current.filter((claim) => claim.id !== id));
    }

    async function approve() {
        if (!profile) return;
        setApproving(true);
        setError('');
        try {
            const response = await fetch(`${apiUrl}/api/resumes/${profile.resumeId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claims: claims.map(({ id, text }) => ({ id, text })) }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message ?? 'Approval failed.');
            setProfile(result);
            setClaims(result.claims);
        } catch (approvalError) {
            setError(approvalError instanceof Error ? approvalError.message : 'Approval failed.');
        } finally {
            setApproving(false);
        }
    }

    return (
        <main>
            <p className="eyebrow">Phase 1 / Resume intake</p>
            <h1>Build the factual profile first.</h1>
            <p className="intro">
                Upload a DOCX to extract a reviewable source record. Every claim stays linked to the paragraph it came from.
            </p>
            <form className="upload-form" onSubmit={upload}>
                <label htmlFor="file">Base resume (.docx)</label>
                <input id="file" name="file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
                <button type="submit" disabled={uploading}>{uploading ? 'Extracting...' : 'Extract profile'}</button>
            </form>
            {error && <p className="error" role="alert">{error}</p>}
            {profile && (
                <section className="review" aria-label="Extracted resume profile">
                    <div className="review-heading">
                        <div><p className="eyebrow">Review draft</p><h2>{profile.claims.length} source-backed claims</h2></div>
                        <span className="status"><span className="status-dot" aria-hidden="true" />{profile.status === 'approved' ? 'Approved factual profile' : 'Needs your review'}</span>
                    </div>
                    <p className="review-help">Correct wording or remove anything that should not be used later. Each kept claim remains linked to its original source paragraph.</p>
                    <ol>{claims.map((claim) => <li key={claim.id}><div className="claim-meta"><strong>{claim.id}</strong><small>{claim.section} · Evidence: {claim.evidence[0]?.sourceSegmentId}</small></div><textarea aria-label={`Claim ${claim.id}`} value={claim.text} onChange={(event) => updateClaim(claim.id, event.target.value)} disabled={profile.status === 'approved'} />{profile.status === 'draft' && <button className="remove-claim" type="button" onClick={() => removeClaim(claim.id)}>Remove claim</button>}</li>)}</ol>
                    {profile.status === 'draft' && <button className="approve-button" type="button" onClick={approve} disabled={approving || claims.length === 0}>{approving ? 'Saving approval...' : 'Approve factual profile'}</button>}
                </section>
            )}
        </main>
    );
}
