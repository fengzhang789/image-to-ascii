#!/usr/bin/env python3
"""Convert an image to Braille Unicode art sized for Discord messages."""

import argparse
from PIL import Image

# Unicode Braille base codepoint (U+2800 = empty braille cell)
BRAILLE_BASE = 0x2800

# Dot bit mappings: DOT_BITS[row][col] → bitmask
# Layout in a braille cell (2 cols × 4 rows):
#   col 0 (left):  rows 0-3 → 0x01, 0x02, 0x04, 0x40
#   col 1 (right): rows 0-3 → 0x08, 0x10, 0x20, 0x80
DOT_BITS = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
]


def image_to_braille(image_path: str, char_width: int = 60,
                     invert: bool = False, threshold: int = 128) -> str:
    """Convert an image to Braille Unicode art."""
    img = Image.open(image_path)

    # Flatten transparency onto white background
    if img.mode in ("RGBA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
        img = background

    img = img.convert("L")  # grayscale

    # Each braille char covers 2 pixels wide × 4 pixels tall.
    # Terminal chars are ~2× taller than wide, matching the 4:2 braille cell ratio,
    # so no additional aspect correction is needed.
    pixel_width = char_width * 2
    orig_w, orig_h = img.size
    pixel_height = max(4, round(pixel_width * orig_h / orig_w))

    img = img.resize((pixel_width, pixel_height), Image.LANCZOS)
    pixels = list(img.getdata())

    char_height = -(-pixel_height // 4)  # ceil division
    lines = []

    for cy in range(char_height):
        line = []
        for cx in range(char_width):
            bits = 0
            for dy in range(4):
                for dx in range(2):
                    px = cx * 2 + dx
                    py = cy * 4 + dy
                    if px >= pixel_width or py >= pixel_height:
                        continue
                    lum = pixels[py * pixel_width + px]
                    if invert:
                        lum = 255 - lum
                    if lum < threshold:
                        bits |= DOT_BITS[dy][dx]
            line.append(chr(BRAILLE_BASE + bits))
        lines.append("".join(line).rstrip())

    return "\n".join(lines).rstrip("\n")


def main():
    parser = argparse.ArgumentParser(
        description="Convert an image to Braille Unicode art for Discord."
    )
    parser.add_argument("image", help="Path to the input image")
    parser.add_argument(
        "-w", "--width", type=int, default=60,
        help="Width in characters (default: 60)",
    )
    parser.add_argument(
        "-t", "--threshold", type=int, default=128,
        help="Brightness threshold 1-254 (default: 128); lower = fewer dots",
    )
    parser.add_argument(
        "-i", "--invert", action="store_true",
        help="Invert brightness (useful for dark images on light backgrounds)",
    )
    parser.add_argument("-o", "--output", help="Save output to a file")
    parser.add_argument(
        "--no-codeblock", action="store_true",
        help="Skip wrapping in a Discord code block",
    )
    args = parser.parse_args()

    art = image_to_braille(args.image, args.width, args.invert, args.threshold)
    result = art if args.no_codeblock else f"```\n{art}\n```"

    if args.output:
        with open(args.output, "w") as f:
            f.write(result)
        print(f"Saved to {args.output}")
    else:
        print(result)


if __name__ == "__main__":
    main()
