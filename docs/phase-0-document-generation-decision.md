# Phase 0 Document Generation Decision

**Date:** 2026-09-08
**Status:** Accepted for the first release

## Decision

Generate the ATS-safe DOCX first from the approved structured resume, then render
PDF from that DOCX. This keeps the DOCX and PDF text aligned and makes the DOCX
the canonical export artifact.

## Initial library choices

- **DOCX:** `docx` for programmatic generation from structured resume content.
- **PDF:** LibreOffice headless conversion from DOCX to PDF in the local runtime.
- **Verification:** extract text from both artifacts after generation and compare it
to the approved final content. Add structural checks for single-column output,
standard headings, and the absence of tables or text boxes.

## Constraints

- The first release requires LibreOffice to be installed and available on `PATH`
  for PDF conversion.
- The generator must use one column, ordinary paragraphs, standard bullets, and a
  standard font such as Aptos, Arial, or Calibri.
- PDF generation must not become a second content-generation path.
- A later polished template may use a different renderer, but it must remain
  separate from the ATS-safe export.

## Revisit criteria

Revisit this decision only if local LibreOffice conversion is unreliable on the
target Windows setup, or if artifact text comparison finds material DOCX/PDF
content drift. Any replacement must preserve DOCX-first generation and automated
post-generation verification.
