from __future__ import annotations

import json
import re
import sys
from pathlib import Path


FIXTURE_NAMES = ("TYPE_2_FIXTURE_A", "TYPE_2_FIXTURE_B")


def extract(source: str, name: str) -> str:
    match = re.search(
        rf"export const {re.escape(name)}\s*=\s*(\"(?:[^\"\\]|\\.)*\")",
        source,
    )
    if match is None:
        raise ValueError(f"missing canonical fixture {name}")
    value = json.loads(match.group(1))
    if not isinstance(value, str):
        raise TypeError(f"canonical fixture {name} is not a string")
    return value


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate_fixtures.py SOURCE OUTPUT")
    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    source = source_path.read_text(encoding="utf-8")
    fixtures = {name: extract(source, name) for name in FIXTURE_NAMES}
    lines = [
        "/* Generated from packages/device-sassi/test/fixtures.ts. */",
        "#ifndef TAN_SASSI_FIXTURES_H",
        "#define TAN_SASSI_FIXTURES_H",
        "",
    ]
    for name, value in fixtures.items():
        lines.append(f"static const char {name}[] = {json.dumps(value)};")
    lines.extend(["", "#endif", ""])
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
