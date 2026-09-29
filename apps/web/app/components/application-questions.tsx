'use client';

import { useEffect, useRef, useState } from 'react';
import { answerCounts, answerWithinLimit } from '@resume-tweak/contracts';
import type { ApplicationAnswer, ApplicationAnswersResponse, ApplicationQuestion, AnswerLimit } from '@resume-tweak/contracts';

type Profile = { resumeId: string; status: string; claims: { id: string; text: string }[] };
type QuestionCard = ApplicationQuestion & { result?: ApplicationAnswer; editedText?: string };
const newQuestion = (): QuestionCard => ({ id: crypto.randomUUID(), question: '', factualNotes: '' });
const labels = { answered: 'Draft ready', partial: 'Partial draft — details missing', 'needs-user-input': 'Needs your input', failed: 'Could not generate' };

export function ApplicationQuestions({ profile, sourceLabel, tailoringJobDescription, apiUrl, disabled = false }: {
    profile: Profile | null; sourceLabel: string; tailoringJobDescription: string; apiUrl: string; disabled?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const [cards, setCards] = useState<QuestionCard[]>([]);
    const [jobDescription, setJobDescription] = useState('');
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const revisions = useRef<Record<string, number>>({});
    const controllers = useRef(new Set<AbortController>());
    const mounted = useRef(true);
    const ready = profile?.status === 'approved' && !disabled;
    const pending = Object.values(busy).some(Boolean);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; controllers.current.forEach((controller) => controller.abort()); };
    }, []);

    function invalidate(id: string) {
        revisions.current[id] = (revisions.current[id] ?? 0) + 1;
        setBusy((current) => ({ ...current, [id]: false }));
        setError(''); setNotice('');
    }
    function change(id: string, values: Partial<ApplicationQuestion>) {
        invalidate(id);
        setCards((current) => current.map((card) => card.id === id ? { ...card, ...values, result: undefined, editedText: undefined } : card));
    }
    function changeContext(value: string) {
        controllers.current.forEach((controller) => controller.abort());
        cards.forEach((card) => invalidate(card.id));
        setJobDescription(value);
        setCards((current) => current.map((card) => ({ ...card, result: undefined, editedText: undefined })));
    }
    function clear() {
        if (cards.some((card) => card.question || card.factualNotes || card.result) && !window.confirm('Clear all questions, notes and answers?')) return;
        controllers.current.forEach((controller) => controller.abort());
        cards.forEach((card) => invalidate(card.id));
        setCards([]); setJobDescription(''); setBusy({}); setError(''); setNotice('Section cleared.');
    }
    async function generate(selected: QuestionCard[]) {
        if (!ready || !profile || !selected.length) return;
        if (selected.some((card) => card.editedText !== undefined) && !window.confirm('Regenerate and replace your manually edited answer?')) return;
        if (selected.some((card) => !card.question.trim() || (card.limit && (!Number.isInteger(card.limit.value) || card.limit.value < 1 || card.limit.value > (card.limit.unit === 'words' ? 500 : 3000))))) {
            setError('Enter a question and a valid limit (1–500 words or 1–3,000 characters).'); return;
        }
        setError(''); setNotice('Generating and checking supporting facts…');
        const snapshots = Object.fromEntries(selected.map((card) => [card.id, (revisions.current[card.id] ?? 0) + 1]));
        Object.assign(revisions.current, snapshots);
        setBusy((current) => ({ ...current, ...Object.fromEntries(selected.map((card) => [card.id, true])) }));
        setCards((current) => current.map((card) => card.id in snapshots ? { ...card, result: undefined, editedText: undefined } : card));
        const controller = new AbortController(); controllers.current.add(controller);
        const currentIds = () => selected.filter((card) => revisions.current[card.id] === snapshots[card.id]).map((card) => card.id);
        try {
            const response = await fetch(`${apiUrl}/api/resumes/${encodeURIComponent(profile.resumeId)}/application-answers`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, cache: 'no-store',
                body: JSON.stringify({ questions: selected.map(({ id, question, factualNotes, limit }) => ({ id, question: question.trim(), factualNotes: factualNotes?.trim() || undefined, limit })), jobDescription: jobDescription.trim() || undefined }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message ?? 'Answer generation failed.');
            const result = data as ApplicationAnswersResponse;
            if (result.resumeId !== profile.resumeId || !Array.isArray(result.answers) || result.answers.length !== selected.length || new Set(result.answers.map((a) => a.questionId)).size !== selected.length || result.answers.some((a) => !(a.questionId in snapshots))) throw new Error('Unexpected answer response. Please retry.');
            if (!mounted.current || controller.signal.aborted) return;
            const validIds = currentIds();
            setCards((current) => current.map((card) => validIds.includes(card.id) ? { ...card, result: result.answers.find((answer) => answer.questionId === card.id) } : card));
            if (validIds.length) setNotice('Answers checked. Review every draft before using it.');
        } catch (reason) {
            if (mounted.current && !controller.signal.aborted && currentIds().length) setError(reason instanceof Error ? reason.message : 'Answer generation failed.');
        } finally {
            controllers.current.delete(controller);
            if (mounted.current) setBusy((current) => ({ ...current, ...Object.fromEntries(currentIds().map((id) => [id, false])) }));
        }
    }
    async function copy(card: QuestionCard) {
        const text = card.editedText ?? card.result?.answerText ?? '';
        try { await navigator.clipboard.writeText(text); if (mounted.current) setNotice('Answer copied.'); }
        catch { if (mounted.current) setError('Clipboard access failed. Select the answer text and copy it manually.'); }
    }

    return <section className="application-questions" aria-label="Application questions">
        <button className="accordion-trigger" type="button" aria-expanded={expanded} aria-controls="application-question-panel" onClick={() => { setExpanded(!expanded); if (!cards.length) setCards([newQuestion()]); }}>
            <span><b>Application questions</b><small>Optional · turn your experience into thoughtful answers</small></span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
        <div id="application-question-panel" hidden={!expanded} className="question-panel">
            <p className="review-help">Draft answers to application-portal questions without creating a tailored resume. Uses your approved original profile, not the wording of an exported version.</p>
            <p className="question-source"><strong>Source:</strong> {profile ? sourceLabel : 'No approved resume selected'}</p>
            {!ready && <p className="review-help">{disabled ? 'Loading the selected source…' : 'Upload or select a resume and approve its factual profile to generate answers.'}</p>}
            <p className="review-help">Page session only — refresh or leave and these answers are lost. Your resume, questions and notes are sent to the configured AI provider. Review all facts; automated checks are not a guarantee.</p>
            <label htmlFor="answer-job-context">Job description <small>optional · {jobDescription.length}/20,000</small></label>
            <textarea id="answer-job-context" value={jobDescription} maxLength={20000} onChange={(event) => changeContext(event.target.value)} placeholder="Paste a job description to focus the answer on relevant experience." />
            <button type="button" className="question-secondary" disabled={!tailoringJobDescription} onClick={() => changeContext(tailoringJobDescription)}>Use current tailoring job description</button>
            <p className="review-help">This copies the current description. Later edits in the tailoring section will not change it.</p>
            {cards.map((card, index) => {
                const text = card.editedText ?? card.result?.answerText ?? '';
                const counts = answerCounts(text);
                const withinLimit = answerWithinLimit(text, card.limit);
                return <article className="question-card" key={card.id} aria-busy={Boolean(busy[card.id])}>
                    <div className="question-card-heading"><h3>Question {index + 1}</h3><button type="button" className="question-secondary" onClick={() => { invalidate(card.id); setCards((current) => current.filter((item) => item.id !== card.id)); }}>Remove question {index + 1}</button></div>
                    <label htmlFor={`question-${card.id}`}>Application question {index + 1}</label>
                    <textarea id={`question-${card.id}`} value={card.question} maxLength={2000} onChange={(event) => change(card.id, { question: event.target.value })} placeholder="Tell us about a time you took ownership of a complex technical problem. How did you approach it, and what impact did it have?" />
                    <label htmlFor={`notes-${card.id}`}>Factual notes for question {index + 1} <small>optional</small></label>
                    <textarea id={`notes-${card.id}`} value={card.factualNotes ?? ''} maxLength={4000} onChange={(event) => change(card.id, { factualNotes: event.target.value })} placeholder="Add true details missing from your resume: the situation, your actions, and the outcome." />
                    <p className="review-help">These are user-provided facts, not verified resume evidence. Used only for this question; they do not change your resume.</p>
                    <div className="question-limits"><label>Answer limit {index + 1}<select value={card.limit?.unit ?? ''} onChange={(event) => change(card.id, { limit: event.target.value ? { unit: event.target.value as AnswerLimit['unit'], value: event.target.value === 'words' ? 200 : 1500 } : undefined })}><option value="">Default: concise</option><option value="words">Words</option><option value="characters">Characters</option></select></label>
                        {card.limit && <label>Maximum {card.limit.unit} {index + 1}<input type="number" min={1} max={card.limit.unit === 'words' ? 500 : 3000} value={Number.isNaN(card.limit.value) ? '' : card.limit.value} onChange={(event) => change(card.id, { limit: { ...card.limit!, value: event.target.valueAsNumber } })} /></label>}</div>
                    <button type="button" className="approve-button" disabled={!ready || pending || !card.question.trim()} onClick={() => void generate([card])}>{busy[card.id] ? 'Drafting and checking…' : card.result ? `Regenerate answer ${index + 1}` : `Generate answer ${index + 1}`}</button>
                    {card.result && <div className="question-result">
                        <p className={`answer-status answer-${card.result.status}`}>{labels[card.result.status]}</p>
                        {card.result.error && <p className="error" role="alert">{card.result.error}</p>}
                        {card.result.answerText && <><label htmlFor={`answer-${card.id}`}>Answer {index + 1} — editable</label><textarea id={`answer-${card.id}`} className="answer-text" value={text} onChange={(event) => { setNotice(''); setCards((current) => current.map((item) => item.id === card.id ? { ...item, editedText: event.target.value } : item)); }} />
                            <p className={withinLimit ? 'review-help' : 'error'}>{counts.words} words · {counts.characters} characters{card.limit ? ` · maximum ${card.limit.value} ${card.limit.unit}` : ''}{!withinLimit && ' — over limit; shorten before copying.'}</p>
                            {card.editedText !== undefined && <p className="review-help">User-edited — not revalidated. Sources below support the generated draft only.</p>}
                            <button type="button" className="question-secondary" disabled={!ready || !text.trim() || !withinLimit || card.result.status === 'failed'} onClick={() => void copy(card)}>Copy answer {index + 1}</button></>}
                        {card.result.missingInformation.length > 0 && <aside className="gaps"><strong>Details to add or clarify</strong><ul>{card.result.missingInformation.map((gap, i) => <li key={i}>{gap}</li>)}</ul><p>Add factual notes above, then regenerate. Partial drafts may not fully answer the question.</p></aside>}
                        {card.result.statements.length > 0 && <details className="answer-evidence"><summary>Supporting sources for generated draft</summary><ul>{card.result.statements.map((statement) => <li key={statement.id}><p>{statement.text}</p>{statement.evidence.map((e, i) => <div key={`resume-${i}`}><strong>Approved resume · {e.sourceFactId}</strong><blockquote>{e.quote}</blockquote><small>{profile?.claims.find((claim) => claim.id === e.sourceFactId)?.text}</small></div>)}{statement.noteReferences.map((n, i) => <div key={`note-${i}`}><strong>User-provided note · not resume-verified</strong><blockquote>{n.quote}</blockquote></div>)}</li>)}</ul></details>}
                    </div>}
                </article>;
            })}
            <div className="question-actions"><button className="question-secondary" type="button" disabled={cards.length >= 5} onClick={() => setCards((current) => [...current, newQuestion()])}>Add question</button><button className="approve-button" type="button" disabled={!ready || pending || !cards.length || cards.some((card) => !card.question.trim())} onClick={() => void generate(cards)}>Generate all answers</button><button className="question-secondary" type="button" onClick={clear}>Clear section</button></div>
            <p className="review-help">Up to 5 questions. All answers are capped at 500 words and 3,000 characters. Characters include spaces and use Unicode code points; words are whitespace-separated. Portal counters may differ.</p>
            {error && <p className="error" role="alert">{error}</p>}<p role="status" aria-live="polite" className="review-help">{notice}</p>
        </div>
    </section>;
}