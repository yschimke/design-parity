#!/usr/bin/env python3
"""Regenerate the golden fixture PNGs (solid-colour blocks, no deps).

Run from the repo root: ``python3 scripts/gen-fixtures.py``.
The expected normalized JSON is hand-maintained; only the PNGs are generated.
"""
import zlib
import struct


def png(path: str, w: int, h: int, rgb: tuple[int, int, int]) -> None:
    def chunk(typ: bytes, data: bytes) -> bytes:
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(
            ">I", zlib.crc32(c) & 0xFFFFFFFF
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    row = b"\x00" + bytes(rgb) * w
    idat = zlib.compress(row * h, 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))
    print(f"wrote {path} {w}x{h}")


FIXTURES = [
    ("fixtures/figma/button-primary.light.png", 160, 48, (0x64, 0x5A, 0xFF)),
    ("fixtures/figma/button-primary.dark.png", 160, 48, (0x8A, 0x82, 0xFF)),
    ("fixtures/stitch/offer-card.light.png", 240, 160, (0xF5, 0xF5, 0xF7)),
    ("fixtures/claude-design/offer-card.light.png", 240, 160, (0xF5, 0xF5, 0xF7)),
    ("fixtures/candidate/button-primary.light.png", 160, 48, (0x64, 0x5A, 0xFF)),
    ("fixtures/candidate/button-primary.dark.png", 160, 48, (0x7A, 0x72, 0xF0)),
    ("fixtures/bundle/offer-card/offer-card.light.png", 240, 160, (0xF5, 0xF5, 0xF7)),
    ("fixtures/bundle/offer-card/offer-card.dark.png", 240, 160, (0x1A, 0x1A, 0x1A)),
]

if __name__ == "__main__":
    for path, w, h, rgb in FIXTURES:
        png(path, w, h, rgb)
