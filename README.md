# Resume Tweak

Local-first resume tailoring app: Next.js web UI, NestJS API, and shared TypeScript contracts.

## Local setup

- Node.js 24 LTS (verified with 24.21.0).
- pnpm 10.17.1, pinned in `package.json`. Enable it with `corepack enable pnpm`.
- Install workspace dependencies from the repository root with `pnpm install --frozen-lockfile`. Use pnpm rather than npm for this workspace.
- No database or Docker service is required; application data is stored under `data/`.

## Run

In VS Code, select **Terminal > Run Task > Start Project** to start both services.
Alternatively, run `pnpm start:api` and `pnpm start:web` in separate terminals from the repository root.

| Service | URL |
| --- | --- |
| Web UI | http://localhost:3001 |
| API health | http://localhost:3000/api/health |
| API documentation | http://localhost:3000/api/docs |

The API startup script builds the shared contracts before starting its watcher.
Stop the services with **Terminal > Terminate Task**, or Ctrl+C in their terminals.
For remote VS Code sessions, forward **both** ports 3000 and 3001 privately.
If the browser-facing API URL changes, set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` and restart the web app.

## Enable AI tailoring

Copy `apps/api/.env.example` to `apps/api/.env` and enter your configuration locally:

| Variable | Required value |
| --- | --- |
| `FOUNDRY_PROJECT_ENDPOINT` | The OpenAI-compatible base URL, for example `https://YOUR-RESOURCE.openai.azure.com/openai/v1/` |
| `FOUNDRY_API_KEY` | Your resource's API key; never put it in frontend configuration or chat |
| `FOUNDRY_DEFAULT_MODEL_DEPLOYMENT` | Your actual Azure deployment name, supporting Responses API and structured outputs |

Important: the existing `.env.example` endpoint omits `/openai/v1/`; include that path for an Azure OpenAI resource because the current client uses the configured URL directly. This is not the Foundry project-management endpoint.

Keep `FOUNDRY_SMOKE_TEST_ENABLED=false` during normal development. The current client does not send `FOUNDRY_DEFAULT_MODEL_API_VERSION` as a query parameter; it uses the v1 endpoint.

Restart the API after changing `.env`. The UI and health endpoint work without credentials, but a healthy API does not prove that model access is configured. Live AI requests send resume/job content to the configured service and can incur Azure charges.

See [Microsoft's Responses API setup documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses).

## Application questions (optional)

After uploading or selecting a resume and approving its factual profile, open **Application questions** below the resume workflow. No tailoring run or export is required.

- Enter up to five portal questions. Add optional factual notes for each question (for example, your approach and the impact of a project). Notes are user-provided facts, not verified resume evidence, and never modify the resume.
- Optionally paste a job description or copy the current tailoring description. This is a snapshot; subsequent tailoring edits do not change the question context.
- Choose a maximum of 1–500 words or 1–3,000 characters per answer. All answers also have a global ceiling of 500 words and 3,000 characters. Words are whitespace-separated; characters are Unicode code points, including spaces/newlines. Portal counters may differ.
- Generate all answers or one at a time, review supporting sources and missing-information prompts, edit, and copy individual answers. Copy includes answer text only. Manual edits are not revalidated; regenerating asks before replacing them.
- Partial answers may not fully address the question. Add true details in notes and regenerate. Missing ownership, actions, metrics, personal preferences, or application eligibility details must not be invented.

Questions, notes and answers live **only in the current page's memory**. Refreshing, leaving, or changing the source resume clears the section. Changes to a question, notes or limit invalidate its answer; changing job context invalidates all answers. A saved version uses its approved original factual profile, not the exported wording.

The API (`POST /api/resumes/:resumeId/application-answers`) uses the existing server-side Foundry configuration, validates citations and exact supporting quotes, and runs a separate model support review. Failed/over-limit drafts are withheld rather than truncated. Checks are best effort, not proof of truth: review every answer before submission. Requests send resume content, questions, and notes to the configured provider and may incur charges; page-only storage does not imply provider-side nonretention. Nothing is automatically submitted to portals or persisted by this endpoint.

Input limits: question 2,000 characters, notes 4,000 characters per question, job context 20,000 characters. Model pipelines run at most two questions concurrently within each request.

## Document export prerequisites

Install LibreOffice Writer in the same Linux environment running the API, with `soffice` available on PATH. On Ubuntu/Debian, install the `libreoffice-writer` package using your system package manager; this may require administrator permission. Installing it only on a Windows host will not provide the Linux binary for WSL.

Export generates DOCX and PDF together, so missing LibreOffice blocks the export workflow. Uploads accept DOCX and text-based PDF, not scanned/image-only PDF.

## Validation

- API build: `pnpm build`
- Web production build: `pnpm build:web`
- Unit tests: `pnpm --filter @resume-tweak/api test --runInBand`
- End-to-end tests: `pnpm test:e2e` (PDF-related tests need LibreOffice)
- Application-question UI tests: `pnpm --filter @resume-tweak/web test --run`

Do not expose this development app publicly: it handles personal resume data and currently has no user authentication.