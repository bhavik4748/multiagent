import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './page';

const questionText = 'How have you improved a service?';
const notesText = 'I documented the rollout and shared it with the team.';
const answerText = 'I built a service and documented its rollout.';
const jobDescription = 'Build and maintain reliable services with a collaborative engineering team.';
const profile = (resumeId: string, status: 'draft' | 'approved' = 'approved') => ({
    resumeId, status,
    claims: [{ id: 'fact-1', text: 'Built a service.', section: 'experience', evidence: [{ sourceFactId: 'fact-1', sourceSegmentId: 'segment-1' }] }],
});
const versions = ['alpha', 'beta'].map((id) => ({
    versionId: id, versionType: 'general', targetRole: `Example role ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z', unresolvedGaps: [],
    artifacts: { docxPath: `${id}.docx`, pdfPath: `${id}.pdf` },
}));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function answerResponse(resumeId: string, options?: RequestInit, text = answerText) {
    const input = JSON.parse(options?.body as string) as { questions: { id: string }[] };
    return json({
        resumeId, modelProfileId: 'test-model', deployment: 'test-deployment',
        answers: input.questions.map(({ id }) => ({
            questionId: id, status: 'answered', answerText: text, missingInformation: [],
            statements: [{
                id: 'statement-1', text,
                evidence: [{ sourceFactId: 'fact-1', sourceSegmentId: 'segment-1', quote: 'Built a service.' }],
                noteReferences: [],
            }],
        })),
    });
}

type Handler = (options?: RequestInit) => Response | Promise<Response>;
function mockApi(overrides: Record<string, Handler> = {}) {
    const routes: Record<string, Handler> = {
        '/api/resumes/upload': () => json(profile('uploaded-source')),
        '/api/resume-versions': () => json(versions),
        '/api/resume-versions/alpha/source-profile': () => json(profile('source-alpha')),
        '/api/resume-versions/beta/source-profile': () => json(profile('source-beta')),
        ...overrides,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
        const path = new URL(String(input)).pathname;
        if (routes[path]) return routes[path](options);
        const match = /^\/api\/resumes\/([^/]+)\/application-answers$/.exec(path);
        if (match) return answerResponse(decodeURIComponent(match[1]), options);
        throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const panel = () => within(screen.getByRole('region', { name: 'Application questions' }));
function openQuestions() {
    const toggle = panel().getByRole('button', { name: /Application questions/ });
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}
function fillQuestion(index = 1) {
    fireEvent.change(panel().getByLabelText(`Application question ${index}`), { target: { value: questionText } });
    fireEvent.change(panel().getByLabelText(new RegExp(`Factual notes for question ${index}`)), { target: { value: notesText } });
}
async function uploadProfile() {
    const input = screen.getByLabelText(/Base resume \(.docx/);
    fireEvent.change(input, {
        target: { files: [new File(['Anonymous test resume'], 'anonymous.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] },
    });
    // jsdom does not update required-file validity when fireEvent supplies files.
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('region', { name: 'Extracted resume profile' });
}
async function loadVersions() {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh versions' }));
    await screen.findByText('Example role beta');
}
function selectVersion(id: 'alpha' | 'beta') {
    const item = screen.getByText(`Example role ${id}`).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: 'Use as source' }));
}
function expectSource(resumeId: string) {
    expect(screen.getByRole('complementary', { name: 'Current base resume' })).toHaveTextContent(`${resumeId} · approved`);
    expect(panel().getByText(`Saved profile ${resumeId}`)).toBeVisible();
}
function expectCleared() {
    expect(panel().queryByLabelText(/Answer \d+ — editable/)).not.toBeInTheDocument();
    expect(panel().queryByRole('button', { name: /Copy answer/ })).not.toBeInTheDocument();
    expect(panel().queryByDisplayValue(notesText)).not.toBeInTheDocument();
    expect(panel().getByLabelText(/Factual notes for question 1/)).toHaveValue('');
}

describe('HomePage optional ApplicationQuestions integration', () => {
    it('enables questions after uploading an already approved profile without tailoring', async () => {
        const fetchMock = mockApi();
        render(<HomePage />);
        openQuestions(); fillQuestion();
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
        expect(panel().getByRole('button', { name: 'Generate all answers' })).toBeDisabled();

        await uploadProfile();
        openQuestions(); fillQuestion();
        expect(panel().getByText('anonymous.docx')).toBeVisible();
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeEnabled();
        expect(panel().getByRole('button', { name: 'Generate all answers' })).toBeEnabled();
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
        expect(await panel().findByLabelText('Answer 1 — editable')).toHaveValue(answerText);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
            '/api/resumes/upload', '/api/resumes/uploaded-source/application-answers',
        ]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: expect.any(FormData) });
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', cache: 'no-store' });
    });

    it('keeps a draft upload gated until factual approval succeeds', async () => {
        const approval = deferred<Response>();
        const fetchMock = mockApi({
            '/api/resumes/upload': () => json(profile('uploaded-source', 'draft')),
            '/api/resumes/uploaded-source/approve': () => approval.promise,
        });
        render(<HomePage />);
        await uploadProfile(); openQuestions(); fillQuestion();
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Approve factual profile and continue' }));
        expect(panel().getByRole('button', { name: 'Generate all answers' })).toBeDisabled();
        await act(async () => approval.resolve(json(profile('uploaded-source'))));
        expect(screen.getByRole('region', { name: 'Tailoring run' })).toBeInTheDocument();
        expect(panel().getByLabelText('Application question 1')).toHaveValue(questionText);
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeEnabled();
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
        await panel().findByLabelText('Answer 1 — editable');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('preserves panel inputs, edited answers and expansion through every workflow stage', async () => {
        const run = {
            runId: 'test-run', status: 'completed', deployment: 'test-deployment', modelProfileId: 'test-model',
            gaps: [], reviewStatus: 'completed', approvalStatus: 'pending',
            finalResume: { claims: [], unresolvedGaps: [], decisions: [], changeLog: [] },
        };
        const fetchMock = mockApi({
            '/api/resumes/uploaded-source/tailoring-runs': () => json(run),
            '/api/tailoring-runs/test-run/approve': () => json({ ...run, approvalStatus: 'approved' }),
        });
        render(<HomePage />);
        await uploadProfile(); openQuestions(); fillQuestion();
        fireEvent.change(panel().getByLabelText(/Job description/), { target: { value: 'Independent application context.' } });
        fireEvent.change(panel().getByLabelText('Answer limit 1'), { target: { value: 'words' } });
        fireEvent.change(panel().getByLabelText('Maximum words 1'), { target: { value: '100' } });
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
        const answer = await panel().findByLabelText('Answer 1 — editable');
        fireEvent.change(answer, { target: { value: 'My reviewed application answer.' } });
        fireEvent.click(panel().getByRole('button', { name: 'Add question' }));
        fireEvent.change(panel().getByLabelText('Application question 2'), { target: { value: 'What did you learn?' } });

        fireEvent.click(screen.getByRole('button', { name: 'Continue to tailoring' }));
        const tailoring = within(screen.getByRole('region', { name: 'Tailoring run' }));
        fireEvent.change(tailoring.getByLabelText(/Job description/), { target: { value: jobDescription } });
        fireEvent.click(tailoring.getByRole('button', { name: 'Create tailored draft' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve final content and continue' }));
        await screen.findByRole('button', { name: 'Generate DOCX and PDF' });

        const workflow = within(screen.getByRole('navigation', { name: 'Resume workflow' }));
        for (const stage of ['Upload', 'Fact review', 'Tailor', 'Review', 'Export']) {
            const button = workflow.getByRole('button', { name: new RegExp(`${stage}$`) });
            expect(button).toBeEnabled(); fireEvent.click(button);
            expect(button).toHaveClass('workflow-current');
            expect(panel().getByRole('button', { name: /Application questions/ })).toHaveAttribute('aria-expanded', 'true');
            expect(panel().getByLabelText('Answer 1 — editable')).toBe(answer);
            expect(answer).toBeVisible();
            expect(answer).toHaveValue('My reviewed application answer.');
            expect(panel().getByLabelText('Application question 1')).toHaveValue(questionText);
            expect(panel().getByLabelText(/Factual notes for question 1/)).toHaveValue(notesText);
            expect(panel().getByLabelText(/Job description/)).toHaveValue('Independent application context.');
            expect(panel().getByLabelText('Answer limit 1')).toHaveValue('words');
            expect(panel().getByLabelText('Maximum words 1')).toHaveValue(100);
            expect(panel().getByLabelText('Application question 2')).toHaveValue('What did you learn?');
            expect(panel().getByText(/User-edited — not revalidated/)).toBeInTheDocument();
        }
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('clears answers and notes immediately on saved-source selection and aborts/ignores a pending answer', async () => {
        const pendingAnswer = deferred<Response>();
        const source = deferred<Response>();
        let pendingOptions: RequestInit | undefined;
        let answerCalls = 0;
        mockApi({
            '/api/resumes/uploaded-source/application-answers': (options) => {
                if (++answerCalls === 1) return answerResponse('uploaded-source', options);
                pendingOptions = options;
                // Deliberately ignore abort here so the component must also reject late results.
                return pendingAnswer.promise;
            },
            '/api/resume-versions/alpha/source-profile': () => source.promise,
        });
        render(<HomePage />);
        await uploadProfile(); openQuestions(); fillQuestion();
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
        await panel().findByLabelText('Answer 1 — editable');
        fireEvent.click(panel().getByRole('button', { name: 'Add question' }));
        fillQuestion(2);
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 2' }));
        expect(pendingOptions?.signal?.aborted).toBe(false);
        await loadVersions(); selectVersion('alpha'); openQuestions();
        expect(pendingOptions?.signal?.aborted).toBe(true);
        expect(panel().getByText('Loading the selected source…')).toBeInTheDocument();
        expectCleared();
        fireEvent.change(panel().getByLabelText('Application question 1'), { target: { value: questionText } });
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
        expect(panel().getByRole('button', { name: 'Generate all answers' })).toBeDisabled();
        await act(async () => source.resolve(json(profile('source-alpha'))));
        expectSource('source-alpha'); expectCleared();
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeEnabled();
        await act(async () => pendingAnswer.resolve(answerResponse('uploaded-source', pendingOptions, 'Stale answer must not appear.')));
        expectCleared();
        expect(panel().queryByDisplayValue('Stale answer must not appear.')).not.toBeInTheDocument();
        expect(panel().queryByText(/Answers checked/)).not.toBeInTheDocument();
        expect(panel().queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
        expect(await panel().findByLabelText('Answer 1 — editable')).toHaveValue(answerText);
    });

    it.each(['success', 'failure'] as const)('ignores an older selection resolving after the latest selection %s', async (latest) => {
        const alpha = deferred<Response>();
        const beta = deferred<Response>();
        const fetchMock = mockApi({
            '/api/resume-versions/alpha/source-profile': () => alpha.promise,
            '/api/resume-versions/beta/source-profile': () => beta.promise,
        });
        render(<HomePage />);
        await uploadProfile(); await loadVersions();
        selectVersion('alpha'); selectVersion('beta'); openQuestions();
        fireEvent.change(panel().getByLabelText('Application question 1'), { target: { value: questionText } });
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
        await act(async () => beta.resolve(latest === 'success' ? json(profile('source-beta')) : json({ message: 'Latest source unavailable.' }, 503)));
        if (latest === 'success') expectSource('source-beta');
        else expect(screen.getByRole('alert')).toHaveTextContent('Latest source unavailable.');

        await act(async () => alpha.resolve(json(profile('source-alpha'))));
        expect(panel().queryByText(/Saved profile source-alpha/)).not.toBeInTheDocument();
        expect(panel().queryByText('Loading the selected source…')).not.toBeInTheDocument();
        if (latest === 'success') {
            expectSource('source-beta');
            expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeEnabled();
            fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
            await panel().findByLabelText('Answer 1 — editable');
            expect(String(fetchMock.mock.calls.at(-1)?.[0])).toMatch(/\/api\/resumes\/source-beta\/application-answers$/);
        } else {
            expect(screen.queryByRole('complementary', { name: 'Current base resume' })).not.toBeInTheDocument();
            expect(screen.getByRole('alert')).toHaveTextContent('Latest source unavailable.');
            expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
            expect(panel().getByRole('button', { name: 'Generate all answers' })).toBeDisabled();
            expect(fetchMock).toHaveBeenCalledTimes(4);
        }
    });

    it('does not leave the previous approved profile usable when a saved-source request fails', async () => {
        const source = deferred<Response>();
        const fetchMock = mockApi({ '/api/resume-versions/alpha/source-profile': () => source.promise });
        render(<HomePage />);
        await uploadProfile(); openQuestions(); fillQuestion();
        fireEvent.click(panel().getByRole('button', { name: 'Generate answer 1' }));
        await panel().findByLabelText('Answer 1 — editable');
        await loadVersions(); selectVersion('alpha'); openQuestions();
        expectCleared();
        fireEvent.change(panel().getByLabelText('Application question 1'), { target: { value: questionText } });
        expect(panel().getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
        await act(async () => source.resolve(json({ message: 'Saved source unavailable.' }, 404)));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Saved source unavailable.'));
        expect(screen.getByRole('button', { name: 'Extract profile' })).toBeInTheDocument();
        expect(screen.queryByRole('complementary', { name: 'Current base resume' })).not.toBeInTheDocument();
        expect(panel().getByText('No approved resume selected')).toBeVisible();
        expect(panel().queryByText('Loading the selected source…')).not.toBeInTheDocument();
        expect(panel().getByText(/Upload or select a resume and approve/)).toBeInTheDocument();
        expectCleared();
        const workflow = within(screen.getByRole('navigation', { name: 'Resume workflow' }));
        expect(workflow.getByRole('button', { name: /Fact review$/ })).toBeDisabled();
        expect(workflow.getByRole('button', { name: /Tailor$/ })).toBeDisabled();
        const generate = panel().getByRole('button', { name: 'Generate answer 1' });
        const generateAll = panel().getByRole('button', { name: 'Generate all answers' });
        expect(generate).toBeDisabled(); expect(generateAll).toBeDisabled();
        const requestCount = fetchMock.mock.calls.length;
        fireEvent.click(generate); fireEvent.click(generateAll);
        expect(fetchMock).toHaveBeenCalledTimes(requestCount);
    });
});