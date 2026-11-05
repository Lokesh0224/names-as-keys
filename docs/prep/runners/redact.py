#!/usr/bin/env python3
"""Redact .env values and URL components from captured human-local evidence."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


REDACTION = "<REDACTED>"


def redaction_values(names: list[str]) -> list[str]:
    values: set[str] = set()
    for name in names:
        value = os.environ.get(name, "")
        if len(value) < 6:
            continue
        values.add(value)
        if "://" not in value:
            continue
        parsed = urlsplit(value)
        if parsed.netloc:
            values.add(parsed.netloc)
        if parsed.hostname:
            values.add(parsed.hostname)
        if parsed.username:
            values.add(parsed.username)
        if parsed.password:
            values.add(parsed.password)
        for segment in parsed.path.split("/"):
            if len(segment) >= 8:
                values.add(segment)
        for pair in re.split(r"[&;]", parsed.query):
            for segment in pair.split("="):
                if len(segment) >= 8:
                    values.add(segment)
    return sorted(values, key=len, reverse=True)


def redact(text: str, values: list[str]) -> str:
    for value in values:
        text = text.replace(value, REDACTION)
    return text


def self_test() -> int:
    fake_url = "https://fake.example.test/FAKE_PATH_123456?token=FAKE_QUERY_123456"
    fake_values = [
        fake_url,
        "fake.example.test",
        "FAKE_PATH_123456",
        "FAKE_QUERY_123456",
    ]
    sample = (
        f"url={fake_url} host=fake.example.test "
        "path=FAKE_PATH_123456 query=FAKE_QUERY_123456"
    )
    output = redact(sample, fake_values)
    passed = all(value not in output for value in fake_values)
    if passed and output.count(REDACTION) >= 4:
        print("REDACTOR SELF-TEST: PASS (synthetic values only)")
        return 0
    print("REDACTOR SELF-TEST: FAIL")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--names", help="comma-separated .env variable names")
    parser.add_argument("--verify", type=Path, help="fail closed if a secret survives")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if args.names is None:
        parser.error("--names is required unless --self-test is used")

    values = redaction_values([name for name in args.names.split(",") if name])
    if args.verify:
        try:
            contents = args.verify.read_text(encoding="utf-8", errors="replace")
        except OSError:
            print("REDACTION CHECK FAILED: log deleted")
            return 2
        if any(value in contents for value in values):
            try:
                args.verify.unlink()
            except OSError:
                pass
            print("REDACTION CHECK FAILED: log deleted")
            return 1
        print("REDACTION CHECK: PASS")
        return 0

    text = sys.stdin.read()
    sys.stdout.write(redact(text, values))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
