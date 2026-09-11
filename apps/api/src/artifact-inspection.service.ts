import { Injectable } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { PDFParse } from 'pdf-parse';

export type ArtifactViolationCode =
    | 'artifact-empty'
    | 'docx-body-empty'
    | 'docx-header-footer-content'
    | 'docx-multiple-columns'
    | 'docx-table'
    | 'docx-drawing'
    | 'pdf-page-count'
    | 'pdf-trailing-page-blank';

export interface ArtifactViolation {
    code: ArtifactViolationCode;
    message: string;
}

export interface DocxInspectionResult {
    text: string;
    paragraphs: string[];
    violations: ArtifactViolation[];
}

export interface PdfInspectionResult {
    text: string;
    pages: string[];
    pageCount: number;
    violations: ArtifactViolation[];
}

export function normalizeArtifactText(value: string): string {
    return value
        .replace(/([\p{L}\p{N}])[-‐‑‒–—]\s+([\p{L}\p{N}])/gu, '$1-$2')
        .replace(/^[\s•●▪◦*-]+/gmu, '')
        .replace(/[‐‑‒–—]/g, '-')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

@Injectable()
export class ArtifactInspectionService {
    private readonly xmlParser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        trimValues: false,
    });

    async inspectDocx(path: string): Promise<DocxInspectionResult> {
        const file = await readFile(path);
        const fileStats = await stat(path);
        return this.inspectDocxBuffer(file, fileStats.size);
    }

    async inspectDocxBuffer(
        buffer: Buffer,
        size = buffer.byteLength,
    ): Promise<DocxInspectionResult> {
        const violations: ArtifactViolation[] = [];
        if (size === 0) {
            violations.push({ code: 'artifact-empty', message: 'DOCX artifact is empty.' });
        }
        const zip = await JSZip.loadAsync(buffer);
        const documentXml = await this.readZipText(zip, 'word/document.xml');
        const paragraphs = this.extractParagraphs(documentXml);
        const headerFooterFiles = Object.keys(zip.files).filter((name) =>
            /^word\/(header|footer)\d+\.xml$/u.test(name),
        );
        const headerFooterText = await Promise.all(
            headerFooterFiles.map(async (name) =>
                this.extractText(await this.readZipText(zip, name)),
            ),
        );

        if (!normalizeArtifactText(paragraphs.join(' '))) {
            violations.push({ code: 'docx-body-empty', message: 'DOCX body contains no text.' });
        }
        if (headerFooterText.some((text) => normalizeArtifactText(text))) {
            violations.push({
                code: 'docx-header-footer-content',
                message: 'DOCX headers and footers must not contain resume content.',
            });
        }
        if (/<w:tbl(?:\s|>)/u.test(documentXml)) {
            violations.push({ code: 'docx-table', message: 'DOCX tables are not ATS-safe.' });
        }
        if (/<w:(?:drawing|pict|txbxContent)(?:\s|\/?>)/u.test(documentXml)) {
            violations.push({ code: 'docx-drawing', message: 'DOCX drawings and text boxes are not ATS-safe.' });
        }
        if (this.hasMultipleColumns(documentXml)) {
            violations.push({ code: 'docx-multiple-columns', message: 'DOCX must use a single column.' });
        }
        return { text: paragraphs.join('\n'), paragraphs, violations };
    }

    async inspectPdf(path: string): Promise<PdfInspectionResult> {
        const buffer = await readFile(path);
        const fileStats = await stat(path);
        const violations: ArtifactViolation[] = [];
        if (fileStats.size === 0) {
            violations.push({ code: 'artifact-empty', message: 'PDF artifact is empty.' });
        }
        const parser = new PDFParse({ data: buffer });
        try {
            const extracted = await parser.getText();
            const pages = extracted.pages.map((page) => page.text);
            const pageCount = extracted.total;
            if (pageCount < 1 || pageCount > 2) {
                violations.push({ code: 'pdf-page-count', message: 'PDF must be between one and two pages.' });
            }
            if (pageCount > 1 && !normalizeArtifactText(pages.at(-1) ?? '')) {
                violations.push({ code: 'pdf-trailing-page-blank', message: 'PDF has a blank trailing page.' });
            }
            return { text: extracted.text, pages, pageCount, violations };
        } finally {
            await parser.destroy();
        }
    }

    private async readZipText(zip: JSZip, name: string): Promise<string> {
        const entry = zip.file(name);
        if (!entry) throw new Error(`DOCX package is missing ${name}.`);
        return entry.async('text');
    }

    private extractParagraphs(xml: string): string[] {
        const parsed = this.xmlParser.parse(xml) as unknown;
        const paragraphs: string[] = [];
        this.walk(parsed, (name, value) => {
            if (name !== 'w:p') return;
            const text = this.extractTextFromNode(value);
            if (text.trim()) paragraphs.push(text.trim());
        });
        return paragraphs;
    }

    private extractText(xml: string): string {
        const parsed = this.xmlParser.parse(xml) as unknown;
        return this.extractTextFromNode(parsed);
    }

    private extractTextFromNode(node: unknown): string {
        const parts: string[] = [];
        this.walk(node, (name, value) => {
            if (name === '#text' && typeof value === 'string') parts.push(value);
            if (name === 'w:tab') parts.push(' ');
            if (name === 'w:br' || name === 'w:cr') parts.push(' ');
        });
        return parts.join('');
    }

    private walk(node: unknown, visit: (name: string, value: unknown) => void): void {
        if (Array.isArray(node)) {
            node.forEach((entry) => this.walk(entry, visit));
            return;
        }
        if (!node || typeof node !== 'object') return;
        for (const [name, value] of Object.entries(node)) {
            visit(name, value);
            this.walk(value, visit);
        }
    }

    private hasMultipleColumns(xml: string): boolean {
        const columns = xml.match(/<w:cols\b[^>]*>/gu) ?? [];
        return columns.some((element) => {
            const match = /w:num=["'](\d+)["']/u.exec(element);
            return match !== null && Number(match[1]) > 1;
        });
    }
}