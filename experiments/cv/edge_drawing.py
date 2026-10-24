"""Bounded, offline EdgeDrawing extraction on the already collected MPDD set."""
import hashlib
import json
import math
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "tmp" / "p1-03"
sys.path.insert(0, str(DATA / "python"))
started = time.perf_counter()
import cv2  # noqa: E402
import numpy as np  # noqa: E402
initialization_ms = (time.perf_counter() - started) * 1000
if cv2.__version__ != "4.12.0" or np.__version__ != "2.2.6":
    raise RuntimeError("NATIVE_VERSION_MISMATCH")
cv2.setNumThreads(1)
manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
out = DATA / "edge-drawing"
out.mkdir(exist_ok=True)
records, failures = [], []
for sample in manifest["items"]:
    try:
        path = DATA / sample["canonicalPath"]
        encoded = path.read_bytes()
        if hashlib.sha256(encoded).hexdigest() != sample["canonicalSha256"]:
            raise RuntimeError("SAMPLE_HASH_MISMATCH")
        decode_started = time.perf_counter()
        gray = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if gray is None or gray.shape != (sample["height"], sample["width"]):
            raise RuntimeError("IMAGE_DIMENSIONS")
        h, w = gray.shape
        if h * w > 1024 * 1024:
            raise RuntimeError("IMAGE_BUDGET")
        decode_ms = (time.perf_counter() - decode_started) * 1000
        tick = time.perf_counter()
        detector = cv2.ximgproc.createEdgeDrawing()
        params = cv2.ximgproc_EdgeDrawing_Params()
        params.NFAValidation = True
        params.PFmode = True
        detector.setParams(params)
        detector.detectEdges(gray)
        edge_ms = (time.perf_counter() - tick) * 1000
        phase = time.perf_counter()
        raw_lines = detector.detectLines()
        line_ms = (time.perf_counter() - phase) * 1000
        phase = time.perf_counter()
        raw_rounds = detector.detectEllipses()
        round_ms = (time.perf_counter() - phase) * 1000
        # OpenCV 4.12 source: [xc,yc,r,0,0,0] or [xc,yc,0,a,b,theta-degrees].
        # a,b are semi-axes, not diameters. No geometric filtering beyond common
        # size/inside-image budgets here; selection is shared in TypeScript.
        rounds = []
        for row in ([] if raw_rounds is None else raw_rounds.reshape(-1, 6)):
            x, y, radius, a, b, degrees = map(float, row)
            rx, ry, angle = (radius, radius, 0.0) if radius > 0 else (a, b, math.radians(degrees))
            if rx < ry:
                rx, ry, angle = ry, rx, angle + math.pi / 2
            if not all(math.isfinite(v) for v in (x, y, rx, ry, angle)):
                continue
            if ry < 7 or rx > min(w, h) * .45 or ry / rx < .18:
                continue
            ex = math.hypot(rx * math.cos(angle), ry * math.sin(angle))
            ey = math.hypot(rx * math.sin(angle), ry * math.cos(angle))
            if x - ex < 0 or x + ex > w or y - ey < 0 or y + ey > h:
                continue
            rounds.append(dict(x=x, y=y, rx=rx, ry=ry, angle=angle))
        lines = [] if raw_lines is None else [
            dict(from_=dict(x=float(v[0]), y=float(v[1])), to=dict(x=float(v[2]), y=float(v[3])))
            for v in raw_lines.reshape(-1, 4)[:2000]
        ]
        lines = [{"from": v["from_"], "to": v["to"]} for v in lines]
        record = dict(id=sample["id"], category=sample["category"], width=w, height=h,
                      canonicalSha256=sample["canonicalSha256"], decodeMs=decode_ms,
                      edgeMs=edge_ms, lineMs=line_ms, roundMs=round_ms,
                      totalMs=(time.perf_counter() - tick) * 1000, lines=lines, rounds=rounds,
                      rawRoundCount=0 if raw_rounds is None else len(raw_rounds))
        (out / (sample["id"] + ".json")).write_text(json.dumps(record, indent=2), encoding="utf-8")
        records.append({k: v for k, v in record.items() if k not in ("lines", "rounds")})
        print(sample["id"], len(rounds), "rounds;", round(record["totalMs"], 1), "ms", flush=True)
    except Exception as error:
        failures.append(dict(id=sample["id"], reason=str(error)))
binary = next(Path(cv2.__file__).parent.glob("*.pyd"))
summary = dict(algorithm="OpenCV contrib EdgeDrawing", opencv=cv2.__version__, numpy=np.__version__,
               python=platform.python_version(), platform=platform.platform(), threads=1,
               initializationMs=initialization_ms, binaryBytes=binary.stat().st_size,
               binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
               parameters=dict(PFmode=True, NFAValidation=True), records=records, failures=failures,
               source="https://github.com/opencv/opencv_contrib/blob/4.12.0/modules/ximgproc/src/edge_drawing.cpp",
               note="Native offline extraction; not a browser/WASM or phone benchmark. Raw internal line features are never shown as candidates.")
(out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
if failures:
    sys.exit(1)
