#!/usr/bin/env python3
"""
PDF generator for JOB-OPS resume builder.
Called by resume-builder.mjs:
  python3 generate-pdf.py <html_file> <output_pdf>
"""

import sys
import os

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 generate-pdf.py input.html output.pdf")
        sys.exit(1)

    html_file = sys.argv[1]
    pdf_file = sys.argv[2]

    if not os.path.exists(html_file):
        print(f"ERROR: HTML file not found: {html_file}")
        sys.exit(1)

    try:
        from weasyprint import HTML, CSS
        from weasyprint.text.fonts import FontConfiguration

        font_config = FontConfiguration()

        # Base URL for resolving relative paths (fonts, images)
        base_url = os.path.dirname(os.path.abspath(html_file))

        html = HTML(filename=html_file, base_url=base_url)
        css = CSS(string='''
            @page {
                size: A4;
                margin: 0;
            }
            body {
                margin: 0;
            }
        ''', font_config=font_config)

        html.write_pdf(
            pdf_file,
            stylesheets=[css],
            font_config=font_config,
            presentational_hints=True
        )
        print(f"SUCCESS: {pdf_file}")
    except ImportError:
        print("ERROR: weasyprint not installed. Run: pip install weasyprint --break-system-packages")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
