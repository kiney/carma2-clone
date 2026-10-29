#!/usr/bin/env python3
"""Run only the identified original HW normal-solver instructions in Unicorn.

Optional research tool, outside application dependencies and production bundles.
Install tools/native-oracle-requirements.txt in a separate virtual environment.
Unicorn's engine is GPL-2.0; its Python package metadata also mentions BSD.
pefile is MIT licensed. Neither dependency nor original executable bytes are
vendored. Results describe numerical routines, not native contact admission or
whole-game behavior. The executable is read as data, never launched by the OS.
"""

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parent.parent
EXPECTED_SHA256 = "698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c"
IMAGE_BASE = 0x400000
IMAGE_SIZE = 0x39F000
ENTRY = 0x4C3900
RETURN_TRAP = 0x30000000
MAX_ROWS = 16
MAX_CASES = 16
MAX_INPUT_BYTES = 1024 * 1024
TIMEOUT_US = 2_000_000
INSTRUCTION_LIMIT = 500_000
OUTPUT = REPO / "artifacts" / "native-normal-oracle.json"
POINTS = {
    0x4C3A11: "iteration",
    0x4C3B13: "dependence",
    0x4C3CE8: "drop_dependent",
    0x4C3E4C: "negative_impulse",
    0x4C42DF: "activate",
    0x4C43CB: "overflow",
    0x4C4492: "correction_needed",
    0x4C44C0: "correction_entered",
    0x4C45CE: "success_tail",
}


def finite_f32(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Matrix and RHS entries must be finite numbers")
    try:
        converted = struct.unpack("<f", struct.pack("<f", value))[0]
    except (OverflowError, struct.error) as exc:
        raise ValueError("Input exceeds the Float32 range") from exc
    if not math.isfinite(converted):
        raise ValueError("Input must remain finite after Float32 conversion")
    return converted


def validate_case(matrix, rhs):
    if not isinstance(rhs, list) or not 1 <= len(rhs) <= MAX_ROWS:
        raise ValueError(f"Each case needs 1–{MAX_ROWS} unilateral rows")
    n = len(rhs)
    if not isinstance(matrix, list) or len(matrix) != n:
        raise ValueError("K must be square and match b")
    if any(not isinstance(row, list) or len(row) != n for row in matrix):
        raise ValueError("K must be square and match b")
    return [[finite_f32(x) for x in row] for row in matrix], [
        finite_f32(x) for x in rhs
    ]


def read_cases(path):
    with path.open("rb") as stream:
        raw = stream.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError(f"Input exceeds {MAX_INPUT_BYTES} bytes")
    report = json.loads(raw)
    controls = report.get("controls") if isinstance(report, dict) else None
    if not isinstance(controls, list) or not 1 <= len(controls) <= MAX_CASES:
        raise ValueError(f"Expected 1–{MAX_CASES} controls containing K and b")
    cases = []
    for index, control in enumerate(controls):
        if not isinstance(control, dict):
            raise ValueError("Each control must be an object containing K and b")
        matrix, rhs = control.get("K"), control.get("b")
        validate_case(matrix, rhs)
        mode = control.get("mode", str(index))
        if not isinstance(mode, str) or len(mode) > 128:
            raise ValueError("Control mode must be a short string")
        cases.append((mode, matrix, rhs, None, None))
    return cases


def analytical_cases():
    return [
        ("single", [[2]], [4], [2], 0),
        ("single_tiny", [[0.00001]], [4], [0], 0),
        ("orthogonal", [[2, 0], [0, 4]], [4, 12], [2, 3], 0),
        ("coupled", [[2, 1], [1, 2]], [4, 5], [1, 2], 0),
        ("opposite", [[1, -1], [-1, 1]], [1, 0.01], [1, 0], -1),
        ("near_dependent", [[1, -0.999999], [-0.999999, 1]],
         [1, 0.01], [1, 0], -1),
        ("three_row_opposite", [[1, -1, 0], [-1, 1, 0], [0, 0, 1]],
         [1, 0.01, 1], [1, 0, 1], -1),
        ("residual_correction", [[2, 1], [1, 2]], [4e6, 5e6], None, 0),
    ]


def load_image(installation, pefile):
    source = installation / "carma2_HW.exe"
    with source.open("rb") as stream:
        executable = stream.read(16 * 1024 * 1024 + 1)
    digest = hashlib.sha256(executable).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError("HW executable SHA-256 does not match the audited revision")
    # Parse only after authenticating the complete input against the audited hash.
    pe = pefile.PE(data=executable)
    if (pe.OPTIONAL_HEADER.ImageBase != IMAGE_BASE
            or pe.OPTIONAL_HEADER.SizeOfImage != IMAGE_SIZE
            or pe.FILE_HEADER.Machine != 0x14C
            or pe.OPTIONAL_HEADER.Magic != 0x10B):
        raise ValueError("Unexpected PE architecture, image base or image size")
    image = pe.get_memory_mapped_image()
    if len(image) > IMAGE_SIZE:
        raise ValueError("Mapped PE exceeds its verified image size")
    pe.close()
    return image, digest


def run_case(image, matrix, rhs, unicorn):
    from unicorn.x86_const import (
        UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX,
        UC_X86_REG_EIP, UC_X86_REG_ESP,
    )

    matrix32, rhs32 = validate_case(matrix, rhs)
    n = len(rhs32)
    uc = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_32)
    uc.mem_map(IMAGE_BASE, IMAGE_SIZE)
    uc.mem_write(IMAGE_BASE, image)
    data = 0x10000000
    uc.mem_map(data, 0x100000)
    uc.mem_map(0x20000000, 0x400000)
    sp = 0x20300000
    uc.mem_map(RETURN_TRAP, 0x1000)
    uc.mem_write(RETURN_TRAP, b"\xcc")
    aa, bb, xx = data, data + 0x10000, data + 0x11000
    indices, count = data + 0x12000, data + 0x13000
    qq, rr = data + 0x30000, data + 0x40000
    for i, row in enumerate(matrix32):
        uc.mem_write(aa + i * 400, struct.pack(f"<{n}f", *row))
    uc.mem_write(bb, struct.pack(f"<{n}f", *rhs32))
    uc.mem_write(0x7429B4, struct.pack("<I", qq))
    uc.mem_write(0x7429B8, struct.pack("<I", rr))
    uc.mem_write(0x692748, struct.pack("<I", 0))
    # Audited fastcall ABI: ECX=K, EDX=b; nine stack arguments after return.
    # Prefix=0 selects ordinary unilateral rows, without cached joint blocks.
    args = [RETURN_TRAP, xx, n, 100, indices, count, 0, 0, 0, 0]
    uc.mem_write(sp, struct.pack("<10I", *args))
    uc.reg_write(UC_X86_REG_ESP, sp)
    uc.reg_write(UC_X86_REG_ECX, aa)
    uc.reg_write(UC_X86_REG_EDX, bb)
    hits, memory_errors, outside = {}, [], []
    execution = {"instructionCount": 0, "minimumAddress": None, "maximumAddress": None}
    scratch = None

    def instruction_hook(engine, address, _size, _data):
        nonlocal scratch
        execution["instructionCount"] += 1
        for key, compare in [("minimumAddress", min), ("maximumAddress", max)]:
            previous = execution[key]
            execution[key] = address if previous is None else compare(previous, address)
        if not (ENTRY <= address <= 0x4C5153 or address == 0x4C5F90):
            outside.append(hex(address))
            engine.emu_stop()
            return
        if address in POINTS:
            key = POINTS[address]
            hits[key] = hits.get(key, 0) + 1
        if address == 0x4C45CE:
            stack = engine.reg_read(UC_X86_REG_ESP)
            scratch = list(struct.unpack(f"<{n}f", engine.mem_read(stack + 0x584, n * 4)))

    def memory_hook(_engine, access, address, size, _value, _data):
        memory_errors.append({"access": access, "address": hex(address), "size": size})
        return False

    uc.hook_add(unicorn.UC_HOOK_CODE, instruction_hook)
    uc.hook_add(unicorn.UC_HOOK_MEM_INVALID, memory_hook)
    error = None
    started = time.monotonic()
    try:
        uc.emu_start(ENTRY, RETURN_TRAP, timeout=TIMEOUT_US, count=INSTRUCTION_LIMIT)
    except unicorn.UcError as exc:
        error = str(exc)
    elapsed = time.monotonic() - started
    eip = uc.reg_read(UC_X86_REG_EIP)
    returned = eip == RETURN_TRAP and not outside and error is None
    status = struct.unpack("<i", struct.pack("<I", uc.reg_read(UC_X86_REG_EAX)))[0]
    output = list(struct.unpack(f"<{n}f", uc.mem_read(xx, n * 4)))
    inactive_count = struct.unpack("<I", uc.mem_read(count, 4))[0]
    # Failed solves may leave list state incomplete: report it without interpreting
    # the list as a final accepted active set.
    inactive = list(uc.mem_read(indices, min(inactive_count, MAX_ROWS)))
    return {
        "K": matrix, "b": rhs, "KFloat32": matrix32, "bFloat32": rhs32,
        "returned": returned, "eip": hex(eip),
        "status": status if returned else None,
        "finiteOutput": all(math.isfinite(x) for x in output),
        "classification": ("nonfinite_output" if not all(math.isfinite(x) for x in output)
                           else "success" if status == 0 else "solver_failure")
        if returned else "incomplete_emulation",
        "x": [x if math.isfinite(x) else None for x in output],
        "scratchActiveXAtSuccessTail": ([x if math.isfinite(x) else None for x in scratch]
                                      if scratch is not None else None),
        "inactiveCount": inactive_count, "inactiveIndices": inactive,
        "hits": hits, "execution": execution, "outsideNumericalCode": outside,
        "memoryErrors": memory_errors, "emulatorError": error,
        "elapsedSeconds": elapsed,
    }


def write_report(report, installation):
    parent = OUTPUT.parent
    if parent.is_symlink() or OUTPUT.is_symlink():
        raise ValueError("Oracle output and artifacts directory must not be symlinks")
    parent.mkdir(exist_ok=True)
    for original in [installation.resolve(), (REPO / "carma2_orig").resolve()]:
        if OUTPUT.resolve().is_relative_to(original):
            raise ValueError("Oracle output must not target an original installation")
    # Atomic replacement also avoids modifying any preexisting hard-linked inode.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=parent, prefix=".native-oracle-",
                                         suffix=".json", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write("\n")
        if parent.is_symlink() or OUTPUT.is_symlink():
            raise ValueError("Oracle output became a symlink")
        os.replace(temporary, OUTPUT)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true", help="Run analytical controls (default)")
    parser.add_argument("--input", type=Path, help="Read bounded controls[].K/b from a contact report")
    args = parser.parse_args()
    try:
        import pefile
        import unicorn
    except ImportError as exc:
        parser.exit(2, f"Optional dependencies missing: install tools/native-oracle-requirements.txt in a venv ({exc})\n")
    installation = Path(os.environ.get("CARMA2_ROOT", str(REPO / "carma2_orig")))
    if not installation.is_absolute():
        installation = Path.cwd() / installation
    image, digest = load_image(installation, pefile)
    cases = analytical_cases() if args.validate or args.input is None else []
    if args.input is not None:
        cases += read_cases(args.input)
    results, valid = [], True
    for name, matrix, rhs, expected, expected_status in cases:
        result = run_case(image, matrix, rhs, unicorn)
        result["name"] = name
        if expected_status is not None:
            passed = (result["returned"] and result["finiteOutput"]
                      and result["status"] == expected_status)
            if expected is not None:
                passed = passed and all(math.isclose(a, b, rel_tol=2e-6, abs_tol=2e-6)
                                        for a, b in zip(result["x"], expected))
            result["validationPassed"] = passed
            valid = valid and passed
        valid = valid and result["returned"] and result["finiteOutput"]
        results.append(result)
    report = {
        "scope": "Isolated original normal-solver math; no Windows/game process, imports or syscalls. Does not establish original geometric admission or full-game behavior.",
        "binarySha256": digest, "imageBase": hex(IMAGE_BASE), "imageSize": IMAGE_SIZE,
        "entry": hex(ENTRY), "returnTrap": hex(RETURN_TRAP),
        "packages": {name: importlib.metadata.version(name) for name in ["unicorn", "pefile"]},
        "dependencyLicenses": {"unicornEngine": "GPL-2.0", "pefile": "MIT"},
        "limitsPerCall": {"timeoutMicroseconds": TIMEOUT_US, "instructions": INSTRUCTION_LIMIT,
                          "maximumRows": MAX_ROWS, "maximumInputBytes": MAX_INPUT_BYTES},
        "allChecksPassed": valid, "results": results,
    }
    write_report(report, installation)
    print(f"Wrote {len(results)} numerical cases to {OUTPUT}; checks passed: {valid}")
    return 0 if valid else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, struct.error) as exc:
        print(f"Native normal oracle: {exc}", file=sys.stderr)
        sys.exit(2)
