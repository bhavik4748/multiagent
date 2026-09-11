# Resume Template Change Visual-Review Checklist

Use this checklist whenever DOCX template generation, paragraph styles, layout, or LibreOffice conversion behavior changes. Review the anonymized golden fixture locally after `pnpm --filter @resume-tweak/api test:artifacts` passes.

## Required review

- [ ] Open the generated DOCX in Microsoft Word or LibreOffice and the generated PDF in a standard PDF viewer.
- [ ] Confirm the candidate identity and contact line are in the document body, not a header or footer.
- [ ] Confirm standard headings are visible and ordered: Summary, Skills, Experience, Education, Certifications, and Additional Information only when populated.
- [ ] Confirm every expected role heading and its achievements are complete, ordered, and non-duplicated.
- [ ] Confirm the output is one or two pages with no blank trailing page or clipped body text.
- [ ] Confirm the layout is single-column and contains no tables, drawings, charts, text boxes, or required header/footer content.
- [ ] Confirm typography, bullets, indentation, and page breaks are recruiter-readable.
- [ ] Record reviewer, date, fixture name, generated artifact paths, and any follow-up issue in the pull request or release notes.

## Release gate

Do not publish a template change until automated artifact verification passes and the completed checklist evidence is recorded. This manual review complements structural tests; it is not replaced by them.