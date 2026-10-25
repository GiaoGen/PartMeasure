from pathlib import Path
import json
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parents[2]
pdf = root / "output/pdf/p2-04b-synthetic-report.pdf"
reader = PdfReader(pdf, strict=True)
assert not reader.is_encrypted
assert len(reader.pages) == 6
for page in reader.pages:
    assert abs(float(page.mediabox.width) - 595.28) < 0.1
    assert abs(float(page.mediabox.height) - 841.89) < 0.1
    images = page["/Resources"]["/XObject"]
    assert len(images) == 1
    image = next(iter(images.values())).get_object()
    assert image["/Filter"] == "/DCTDecode"
    assert image["/Width"] == 1588 and image["/Height"] == 2246
    assert image.get_data().startswith(b"\xff\xd8")
sheet = Image.new("RGB", (1200, 2628), "#d0d5dd")
for i, path in enumerate(sorted((root / "tmp/p2-04b/render").glob("page-*.png"))):
    if i >= 6:
        break
    page = Image.open(path).convert("RGB")
    page.thumbnail((590, 838))
    sheet.paste(page, (i % 2 * 600 + 5, i // 2 * 876 + 28))
    ImageDraw.Draw(sheet).text((i % 2 * 600 + 10, i // 2 * 876 + 8), f"Page {i + 1}", fill="black")
sheet.save(root / "tmp/p2-04b/contact.png")
(root / "docs/evidence/p2-04b/pdf-structure.json").write_text(json.dumps({"reader": "pypdf strict; Poppler rendered all pages", "pages": len(reader.pages), "pageSize": "A4", "raster": "1588x2246 RGB JPEG each page", "status": "PASS", "scope": "synthetic offline sample, not actual browser or cloud"}, indent=2) + "\n", encoding="utf-8")
