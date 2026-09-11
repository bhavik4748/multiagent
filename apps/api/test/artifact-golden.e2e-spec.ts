import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentService } from '../src/document.service';
import type { FinalResumePackage } from '@resume-tweak/contracts';

const describeIfLibreOffice = existsSync('/usr/bin/soffice') ? describe : describe.skip;

describeIfLibreOffice('local LibreOffice artifact golden suite', () => {
    let outputDirectory: string;
    beforeEach(async () => { outputDirectory = await mkdtemp(join(tmpdir(), 'resume-artifact-golden-')); });
    afterEach(async () => { await rm(outputDirectory, { recursive: true, force: true }); });

    it('generates a verified one-to-two-page ATS-safe DOCX/PDF pair from the anonymized fixture', async () => {
        const resume = JSON.parse(await readFile(join(__dirname, 'fixtures/anonymized-render-model.json'), 'utf8')) as FinalResumePackage;
        const artifacts = await new DocumentService().createArtifacts(outputDirectory, 'golden-resume', resume);
        await expect(readFile(artifacts.docxPath)).resolves.toHaveProperty('byteLength', expect.any(Number));
        await expect(readFile(artifacts.pdfPath)).resolves.toHaveProperty('byteLength', expect.any(Number));
    });
});