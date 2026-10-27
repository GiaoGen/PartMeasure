"""Independent read-only validation of files actually downloaded by Chrome."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import sys
import zipfile
from PIL import Image
from pypdf import PdfReader

run = sys.argv[1]
assert len(run) == 36 and all(c in "0123456789abcdef-" for c in run)
root = Path("output/fix-c") / run
state = json.loads((Path("tmp/fix-c") / run / "state.json").read_text(encoding="utf8"))
value = lambda name: state["operations"][name]["value"]
results = []
for extension in ["png", "jpg"]:
    path = root / ("owner-annotated-" + extension + "." + extension)
    with Image.open(path) as image:
        image.load()
        assert image.width > 0 and image.height > 0 and image.width * image.height <= 16000000
        results.append({"name": "actual_" + extension + "_opens", "status": "PASS", "width": image.width, "height": image.height, "bytes": path.stat().st_size})
for name in ["owner-annotated-pdf", "owner-two-photo-history"]:
    path = root / (name + ".pdf")
    if not path.exists():
        if name == "owner-annotated-pdf":
            raise AssertionError("actual browser PDF missing")
        continue
    reader = PdfReader(path)
    assert 1 <= len(reader.pages) <= 60 and path.stat().st_size <= 40 * 1024 * 1024
    for page in reader.pages:
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        assert 590 < width < 600 and 835 < height < 850
        assert len(page.images) == 1
    results.append({"name": name + "_structure", "status": "PASS", "pages": len(reader.pages), "bytes": path.stat().st_size, "rasterA4": True})
with zipfile.ZipFile(root / "owner-package.zip") as archive:
    assert archive.testzip() is None
    manifest = json.loads(archive.read("manifest.json"))
    assert set(archive.namelist()) == {f["path"] for f in manifest["files"]} | {"manifest.json"}
    assert len(archive.namelist()) <= 64
    for file in manifest["files"]:
        parts = PurePosixPath(file["path"])
        assert not parts.is_absolute() and ".." not in parts.parts and "\\" not in file["path"]
        content = archive.read(file["path"])
        assert len(content) == file["byteSize"] and hashlib.sha256(content).hexdigest() == file["sha256"]
        info = archive.getinfo(file["path"])
        assert info.compress_type == zipfile.ZIP_STORED and info.flag_bits & 0x800
    data_bytes = archive.read("data.json")
    data = json.loads(data_bytes)
    assert data["snapshotId"] == manifest["snapshotId"]
    real_photo = value("real-reserve-photo")["id"]
    photo = value("reserve-image")["id"]
    photos = {p["file"]["id"]: p for p in data["photos"]}
    assert set(photos) == {photo, real_photo}
    assert len(photos[real_photo]["document"]["items"]) == 7
    assert all(not item["metadata"]["dimension"] and item["metadata"]["name"].startswith("FIX-C测试") for item in photos[real_photo]["document"]["items"])
    line = value("annotation-line")["id"]
    current = next(a for a in photos[photo]["document"]["items"] if a["id"] == line)
    assert current["revision"] == 2 and current["geometry"]["from"]["y"] == .18
    fixed = next(a for a in data["fixedAnnotations"] if a["annotationId"] == line and a["revision"] == 1)
    assert fixed["source"] == "issue_snapshot" and fixed["annotation"]["geometry"]["from"]["y"] == .15
    assert any(h["annotationId"] == line and h["annotationRevision"] == 1 and h["record"].get("value") == "12.3" for h in data["history"])
    assert {"numeric", "photo", "unable"} <= {h["record"].get("kind") for h in data["history"]}
    assert any(h["kind"] == "review" and h["record"].get("decision") == "remeasure" for h in data["history"])
    assert data["delivery"]["id"] == value("publish-v2")["id"]
    assert value("reserve-private")["id"].encode() not in data_bytes
    assert value("draft-private")["id"].encode() not in data_bytes
    names = archive.namelist()
    assert sum(n.startswith("materials/") for n in names) == 3
    assert sum(n.startswith("originals/") for n in names) == 2
    assert sum(n.startswith("deliveries/") for n in names) == 1
    results.append({"name": "actual_zip_CRC_UTF8_all_hashes_selected_scope_fixed_history", "status": "PASS", "entries": len(names), "photos": 2, "materials": 3, "originals": 2, "deliveryAttachments": 1})
report = {"run": run, "scope": "Independent Pillow/pypdf/zipfile read of actual browser downloads; PDF visual render reviewed separately; desktop only", "results": results}
path = Path("docs/evidence/fix-c") / (run + "-exports-independent.json")
path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
print(json.dumps(report, ensure_ascii=False))
