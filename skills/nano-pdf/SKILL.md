---
name: nano-pdf
description: Edit PDFs with natural-language instructions using the nano-pdf CLI. Supports all languages including CJK (Chinese, Japanese, Korean).
homepage: https://pypi.org/project/nano-pdf/
metadata:
  {
    "openclaw":
      {
        "emoji": "📄",
        "requires": { "bins": ["nano-pdf"] },
        "install":
          [
            {
              "id": "uv",
              "kind": "uv",
              "package": "nano-pdf",
              "bins": ["nano-pdf"],
              "label": "Install nano-pdf (uv)",
            },
          ],
      },
  }
---

# nano-pdf

Use `nano-pdf` to edit existing PDF pages or add new slides using natural-language instructions. Powered by Gemini 3 Pro Image.

## Quick start

```bash
# Edit an existing page
nano-pdf edit deck.pdf 1 "Change the title to 'Q3 Results' and fix the typo in the subtitle"

# Add a new slide
nano-pdf add deck.pdf 0 "Title slide with 'Welcome to Q3 Review'"
```

## CJK / Non-English Support

Fully supported. The PDF generation pipeline uses Pillow native PDF export (no Tesseract dependency), so Chinese, Japanese, Korean, and all other scripts render correctly without font or encoding issues.

When prompting for non-English content, be explicit in the prompt:

```bash
nano-pdf edit report.pdf 1 "把标题改成中文：'第三季度业绩报告'，副标题改为'海管家科技有限公司'"
nano-pdf add deck.pdf 3 "新增一页，标题'市场分析'，包含三个要点：用户增长、营收趋势、竞品对比"
```

## Commands

### edit

Edit one or more pages by providing page-number + prompt pairs:

```bash
nano-pdf edit deck.pdf 1 "Fix the typo" 2 "Make the chart blue" 3 "Add a footer"
```

Options:
- `--style-refs "5,6"` — Use pages 5 and 6 as visual style references
- `--use-context` — Include extracted PDF text as context (can help or confuse the model)
- `--output path.pdf` — Output path (default: `edited_<filename>`)
- `--resolution 4K|2K|1K` — Image quality (default: 4K)
- `--disable-google-search` — Disable Google Search grounding

### add

Insert a new AI-generated slide after a specified page:

```bash
nano-pdf add deck.pdf 0 "Title slide for 'Annual Review 2026'"  # Insert at beginning
nano-pdf add deck.pdf 3 "Summary slide with key takeaways"      # Insert after page 3
```

Same options as `edit` (except `--use-context` is enabled by default for better generation).

## Notes

- Page numbers are 1-indexed
- Requires `GEMINI_API_KEY` environment variable (paid API key with billing enabled)
- Requires `poppler-utils` (`pdftotext`) for text extraction
- Tesseract is **not required** — the pipeline uses Pillow native PDF export
- Always sanity-check the output PDF before sending it out
- Multiple edits on the same page are merged automatically
