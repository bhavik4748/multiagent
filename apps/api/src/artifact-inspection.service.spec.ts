import JSZip from 'jszip';
import { ArtifactInspectionService, normalizeArtifactText } from './artifact-inspection.service';

const documentXml = (body: string, section = '') => `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}${section}</w:body></w:document>`;
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('ArtifactInspectionService DOCX inspection', () => {
    const inspect = async (xml: string, extras: Record<string, string> = {}) => {
        const zip = new JSZip(); zip.file('word/document.xml', xml);
        Object.entries(extras).forEach(([name, content]) => zip.file(name, content));
        return new ArtifactInspectionService().inspectDocxBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    };
    it('extracts body paragraphs in document order', async () => {
        const result = await inspect(documentXml(`${paragraph('Candidate Name')}${paragraph('Experience')}${paragraph('Built services')}`));
        expect(result.paragraphs).toEqual(['Candidate Name', 'Experience', 'Built services']);
        expect(result.violations).toEqual([]);
    });
    it.each([
        ['tables', documentXml('<w:tbl><w:tr/></w:tbl>'), 'docx-table'],
        ['drawings', documentXml('<w:drawing/>'), 'docx-drawing'],
        ['multiple columns', documentXml(paragraph('Text'), '<w:sectPr><w:cols w:num="2"/></w:sectPr>'), 'docx-multiple-columns'],
        ['blank body', documentXml(''), 'docx-body-empty'],
    ])('rejects ATS-unsafe %s', async (_name, xml, code) => {
        const result = await inspect(xml);
        expect(result.violations.map((violation) => violation.code)).toContain(code);
    });
    it('rejects non-empty headers and footers', async () => {
        const result = await inspect(documentXml(paragraph('Body')), { 'word/header1.xml': `<w:hdr xmlns:w="w">${paragraph('Hidden contact')}</w:hdr>` });
        expect(result.violations.map((violation) => violation.code)).toContain('docx-header-footer-content');
    });
    it('normalizes punctuation, bullets, and wrap hyphenation consistently', () => {
        expect(normalizeArtifactText('• “High-\nthroughput” service‑design')).toBe('"high-throughput" service-design');
    });
});