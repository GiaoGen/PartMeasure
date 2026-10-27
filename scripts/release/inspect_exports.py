"""Independent readers for files actually downloaded by the release browser driver."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import sys
import zipfile
from PIL import Image
from pypdf import PdfReader

run = sys.argv[1]
assert len(run) == 36 and all(c in "0123456789abcdef-" for c in run)
root = Path("tmp/p3-05") / run
state = json.loads((root / "state.json").read_text(encoding="utf8"))
scope = state["scope"]
results = []
for extension in ["png", "jpg"]:
    file = root / ("annotated." + extension)
    with Image.open(file) as image:
        image.load()
        assert image.width > 447 and image.height > 447
        assert image.width * image.height <= 16000000
        results.append({"name": extension + "_independent_decode", "status": "PASS", "width": image.width, "height": image.height, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
pdf = root / "annotated.pdf"
reader = PdfReader(pdf)
assert 1 <= len(reader.pages) <= 60 and pdf.stat().st_size <= 40 * 1024 * 1024
for page in reader.pages:
    assert 590 < float(page.mediabox.width) < 600 and 835 < float(page.mediabox.height) < 850
    assert len(page.images) == 1
results.append({"name": "actual_pdf_all_pages_A4_raster", "status": "PASS", "pages": len(reader.pages), "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest()})
zip_path = root / "package.zip"
if zip_path.exists():
    with zipfile.ZipFile(zip_path) as archive:
        assert archive.testzip() is None
        manifest = json.loads(archive.read("manifest.json"))
        assert set(archive.namelist()) == {f["path"] for f in manifest["files"]} | {"manifest.json"}
        assert len(archive.namelist()) <= 64
        for file in manifest["files"]:
            path = PurePosixPath(file["path"])
            assert not path.is_absolute() and ".." not in path.parts and "\\" not in file["path"]
            content = archive.read(file["path"])
            assert len(content) == file["byteSize"] and hashlib.sha256(content).hexdigest() == file["sha256"]
            info = archive.getinfo(file["path"])
            assert info.compress_type == zipfile.ZIP_STORED and info.flag_bits & 0x800
        data_bytes = archive.read("data.json")
        data = json.loads(data_bytes)
        assert data["snapshotId"] == manifest["snapshotId"]
        photos = {p["file"]["id"]: p for p in data["photos"]}
        assert set(photos) == {scope["photo"], scope["syntheticPhoto"]}
        assert len(photos[scope["photo"]]["document"]["items"]) == 7
        assert data["delivery"]["id"] == scope["v2"]
        assert scope["privateDraft"].encode() not in data_bytes and scope["privateFile"].encode() not in data_bytes
        names = archive.namelist()
        assert sum(n.startswith("materials/") for n in names) == 3
        assert sum(n.startswith("originals/") for n in names) == 2
        assert sum(n.startswith("deliveries/") for n in names) == 1
        results.append({"name": "actual_zip_CRC_UTF8_all_hashes_selected_scope", "status": "PASS", "entries": len(names)})
else:
    results.append({"name": "actual_zip_CRC_UTF8_all_hashes_selected_scope", "status": "NOT_RUN_NO_ACTUAL_OUTPUT"})
report = {"run": run, "scope": "Independent Pillow/pypdf/zipfile on actual browser downloads. Visual PDF page review recorded separately; not phone/hosted evidence.", "results": results}
Path(f"docs/evidence/p3-05/batch-{run}-exports-independent.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
print(json.dumps(report, ensure_ascii=False))
