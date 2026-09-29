import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationQuestions } from './application-questions';

const props = { profile: { resumeId: 'r1', status: 'approved', claims: [{ id: 'f1', text: 'Built APIs.' }] }, sourceLabel: 'test.docx', tailoringJobDescription: 'Backend developer', apiUrl: 'http://api.test' };
const open = () => fireEvent.click(screen.getByRole('button', { name: /Application questions/ }));
const question = () => fireEvent.change(screen.getByLabelText('Application question 1'), { target: { value: 'Tell us about ownership.' } });
const response = (body: string) => {
    const input = JSON.parse(body);
    return { ok: true, json: async () => ({ resumeId: 'r1', answers: input.questions.map((q: { id: string }) => ({ questionId: q.id, status: 'partial', answerText: 'I built APIs.', statements: [{ id: 's1', text: 'I built APIs.', evidence: [{ sourceFactId: 'f1', sourceSegmentId: 'seg1', quote: 'Built APIs.' }], noteReferences: [] }], missingInformation: ['What was the impact?'] })) }) };
};
function mockFetch() {
    const fetch = vi.fn(async (_url: string, options: RequestInit) => response(options.body as string));
    vi.stubGlobal('fetch', fetch); return fetch;
}
async function generate() {
    question(); fireEvent.click(screen.getByRole('button', { name: 'Generate answer 1' }));
    await screen.findByLabelText('Answer 1 — editable');
}

describe('Application questions panel', () => {
    it('gates generation on approved source and shows session notice', () => {
        render(<ApplicationQuestions {...props} profile={null} />); open(); question();
        expect(screen.getByRole('button', { name: 'Generate answer 1' })).toBeDisabled();
        expect(screen.getByText(/Page session only/)).toBeInTheDocument();
    });
    it('supports up to five questions and removal', () => {
        render(<ApplicationQuestions {...props} />); open();
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Add question'));
        expect(screen.getByText('Add question')).toBeDisabled();
        fireEvent.click(screen.getByText('Remove question 2'));
        expect(screen.getByText('Add question')).toBeEnabled();
    });
    it('snapshots job context and sends notes only with their question', async () => {
        const fetch = mockFetch(); const view = render(<ApplicationQuestions {...props} />); open();
        fireEvent.click(screen.getByText('Use current tailoring job description'));
        view.rerender(<ApplicationQuestions {...props} tailoringJobDescription="Changed elsewhere" />);
        fireEvent.change(screen.getByLabelText(/Factual notes for question 1/), { target: { value: 'I profiled queries.' } });
        await generate();
        const input = JSON.parse(fetch.mock.calls[0][1].body as string);
        expect(input.jobDescription).toBe('Backend developer');
        expect(input.questions[0].factualNotes).toBe('I profiled queries.');
        expect(input.questions[0].result).toBeUndefined();
    });
    it('copies edited answer only, not citations or missing information', async () => {
        mockFetch(); const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        render(<ApplicationQuestions {...props} />); open(); await generate();
        fireEvent.change(screen.getByLabelText('Answer 1 — editable'), { target: { value: 'My edited answer.' } });
        expect(screen.getByText(/User-edited — not revalidated/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Copy answer 1'));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('My edited answer.'));
        expect(screen.getByText('What was the impact?')).toBeInTheDocument();
    });
    it('blocks over-limit manual edits and confirms regeneration', async () => {
        const fetch = mockFetch(); vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<ApplicationQuestions {...props} />); open(); await generate();
        fireEvent.change(screen.getByLabelText('Answer 1 — editable'), { target: { value: 'x'.repeat(3001) } });
        expect(screen.getByText('Copy answer 1')).toBeDisabled();
        fireEvent.click(screen.getByText('Regenerate answer 1'));
        expect(window.confirm).toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('invalidates drafts when notes, context or limits change', async () => {
        mockFetch(); render(<ApplicationQuestions {...props} />); open(); await generate();
        fireEvent.change(screen.getByLabelText(/Factual notes for question 1/), { target: { value: 'New fact' } });
        expect(screen.queryByLabelText('Answer 1 — editable')).not.toBeInTheDocument();
        await generate();
        fireEvent.change(screen.getByLabelText('Answer limit 1'), { target: { value: 'characters' } });
        expect(screen.queryByLabelText('Answer 1 — editable')).not.toBeInTheDocument();
        await generate();
        fireEvent.change(screen.getByLabelText(/Job description/), { target: { value: 'Other role' } });
        expect(screen.queryByLabelText('Answer 1 — editable')).not.toBeInTheDocument();
    });
    it('retains answer when clipboard permission fails', async () => {
        mockFetch(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
        render(<ApplicationQuestions {...props} />); open(); await generate(); fireEvent.click(screen.getByText('Copy answer 1'));
        expect(await screen.findByRole('alert')).toHaveTextContent('copy it manually');
        expect(screen.getByLabelText('Answer 1 — editable')).toHaveValue('I built APIs.');
    });
    it('ignores a response after input editing', async () => {
        let resolve!: (value: unknown) => void; let body = '';
        vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => { body = options.body as string; return new Promise((done) => { resolve = done; }); }));
        render(<ApplicationQuestions {...props} />); open(); question(); fireEvent.click(screen.getByText('Generate answer 1'));
        fireEvent.change(screen.getByLabelText('Application question 1'), { target: { value: 'A different question' } });
        await act(async () => resolve(response(body)));
        expect(screen.queryByLabelText('Answer 1 — editable')).not.toBeInTheDocument();
    });
    it('aborts and clears answers and notes when the source key changes', async () => {
        const fetch = mockFetch(); const view = render(<ApplicationQuestions key={1} {...props} />); open();
        fireEvent.change(screen.getByLabelText(/Factual notes for question 1/), { target: { value: 'Old source notes' } });
        await generate();
        view.rerender(<ApplicationQuestions key={2} {...props} profile={null} disabled />); open();
        expect(screen.getByLabelText(/Factual notes for question 1/)).toHaveValue('');
        expect(screen.queryByLabelText('Answer 1 — editable')).not.toBeInTheDocument();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('preserves drafts across collapse and reopen', async () => {
        mockFetch(); render(<ApplicationQuestions {...props} />); open(); await generate(); open(); open();
        expect(screen.getByLabelText('Answer 1 — editable')).toHaveValue('I built APIs.');
    });
});