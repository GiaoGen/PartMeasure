from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[2]
with zipfile.ZipFile(root / "output/zip/p2-05-synthetic-package.zip") as archive:
    assert archive.testzip() is None
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["schemaVersion"] == 1
    assert len(archive.namelist()) == 7
    assert set(archive.namelist()) == {file["path"] for file in manifest["files"]} | {"manifest.json"}
    for file in manifest["files"]:
        content = archive.read(file["path"])
        assert len(content) == file["byteSize"]
        assert hashlib.sha256(content).hexdigest() == file["sha256"]
        info = archive.getinfo(file["path"])
        assert info.compress_type == zipfile.ZIP_STORED and info.flag_bits & 0x800
        assert info.date_time == (2026, 10, 25, 21, 0, 0)
        assert ".." not in Path(file["path"]).parts
    data = json.loads(archive.read("data.json"))
    assert data["snapshotId"] == manifest["snapshotId"]
    assert data["history"][0]["record"]["kind"] == "unable"
    assert data["history"][0]["annotationRevision"] == data["fixedAnnotations"][0]["revision"]
    assert any("同名照片" in name for name in archive.namelist())
    assert any(name.startswith("originals/") for name in archive.namelist())
    evidence = {"checker": "Python zipfile independently read every entry and verified CRC, UTF-8, length, SHA256 and metadata references", "entries": len(archive.namelist()), "bytes": archive.fp.seek(0, 2), "status": "PASS", "scope": "synthetic producer sample; not browser, actual Supabase or mobile acceptance"}
(root / "docs/evidence/p2-05").mkdir(parents=True, exist_ok=True)
(root / "docs/evidence/p2-05/package.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print(json.dumps(evidence))
