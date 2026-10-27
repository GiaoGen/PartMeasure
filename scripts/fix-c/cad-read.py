"""Read-only native CAD inspection. No save/export/rebuild, no document creation."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import pythoncom
import win32com.client

run = sys.argv[1]
assert len(run) == 36 and all(c in "0123456789abcdef-" for c in run)
downloaded = Path("output/fix-c") / run / "downloaded-cad.SLDPRT"
source = downloaded if downloaded.exists() else Path(r"D:\document\prarice1.SLDPRT")
expected = "437a805b57356d30f85a8c402e07bf0140f85dd128dd1c5b7edc2f5eafa42b2b"
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
result = {"checkedAt": datetime.now(timezone.utc).isoformat(), "run": run,
          "scope": "Local native SolidWorks read-only open, no save/export/rebuild", "downloadedCopy": downloaded.exists(), "status": "NOT_PASSED"}
pythoncom.CoInitialize()
sw = None
model = None
own_instance = False
opened = False
title = None
stage = "connect"
def value(member):
    return member() if callable(member) else member
try:
    try:
        sw = win32com.client.GetActiveObject("SldWorks.Application")
    except pythoncom.com_error:
        sw = win32com.client.DispatchEx("SldWorks.Application")
        own_instance = True
        sw.Visible = False
    stage = "version"
    result["applicationVersion"] = value(sw.RevisionNumber)
    target = str(source.resolve())
    stage = "find_document"
    model = sw.GetOpenDocumentByName(target)
    if model is None:
        errors = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        warnings = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        # swDocPART=1; swOpenDocOptions_Silent=1 | ReadOnly=2.
        stage = "open_readonly"
        model = sw.OpenDoc6(target, 1, 3, "", errors, warnings)
        result["openErrors"] = errors.value
        result["openWarnings"] = warnings.value
        opened = model is not None
    assert model is not None
    stage = "read_document_properties"
    title = value(model.GetTitle)
    result["documentType"] = value(model.GetType)
    result["configurationCount"] = value(model.GetConfigurationCount)
    assert result["documentType"] == 1
    assert result["configurationCount"] > 0
    result["status"] = "PASS"
except Exception as error:
    result["stage"] = stage
    result["errorClass"] = type(error).__name__
    if isinstance(error, pythoncom.com_error):
        result["hresult"] = error.hresult
finally:
    if opened and sw is not None and title:
        sw.CloseDoc(title)
    if own_instance and sw is not None:
        sw.ExitApp()
    pythoncom.CoUninitialize()
    result["sourceUnchanged"] = hashlib.sha256(source.read_bytes()).hexdigest() == expected
    if not result["sourceUnchanged"]:
        result["status"] = "NOT_PASSED"
    path = Path("docs/evidence/fix-c") / (run + "-cad-read-" + str(int(datetime.now().timestamp())) + ".json")
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(result, ensure_ascii=False))
if result["status"] != "PASS":
    sys.exit(1)
