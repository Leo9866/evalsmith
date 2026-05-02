#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build an APNG tour and contact sheet from EvalSmith UI screenshots.")
    parser.add_argument("capture_dir", type=Path)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=800)
    parser.add_argument("--duration", type=int, default=1300)
    parser.add_argument("--include-errors", action="store_true")
    return parser.parse_args()


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def normalize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = image.convert("RGB")
    if image.size == size:
        return image
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.0))


def draw_label(image: Image.Image, title: str, index: int, total: int) -> Image.Image:
    canvas = image.copy().convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    font = load_font(23)
    small_font = load_font(18)
    bar_height = 54
    draw.rounded_rectangle((18, 16, canvas.width - 18, 16 + bar_height), radius=18, fill=(14, 25, 47, 224))
    draw.text((42, 30), f"EvalSmith · {title}", fill=(255, 255, 255, 255), font=font)
    counter = f"{index:02d}/{total:02d}"
    counter_box = draw.textbbox((0, 0), counter, font=small_font)
    draw.text((canvas.width - 42 - (counter_box[2] - counter_box[0]), 34), counter, fill=(231, 238, 246, 230), font=small_font)
    return canvas.convert("RGB")


def build_contact_sheet(entries: list[dict], output_path: Path) -> None:
    thumb_size = (360, 225)
    cols = 4
    rows = (len(entries) + cols - 1) // cols
    label_height = 34
    gap = 18
    margin = 24
    font = load_font(16)
    sheet = Image.new(
        "RGB",
        (margin * 2 + cols * thumb_size[0] + (cols - 1) * gap, margin * 2 + rows * (thumb_size[1] + label_height) + (rows - 1) * gap),
        (246, 243, 238),
    )
    draw = ImageDraw.Draw(sheet)
    for index, entry in enumerate(entries):
        row, col = divmod(index, cols)
        x = margin + col * (thumb_size[0] + gap)
        y = margin + row * (thumb_size[1] + label_height + gap)
        with Image.open(entry["screenshot"]) as image:
            thumb = normalize(image, thumb_size)
        sheet.paste(thumb, (x, y))
        label = f"{index + 1:02d}. {entry['title']}"
        draw.text((x, y + thumb_size[1] + 8), label[:42], fill=(36, 31, 26), font=font)
    sheet.save(output_path)


def main() -> None:
    args = parse_args()
    report_path = args.capture_dir / "capture-report.json"
    report = json.loads(report_path.read_text())
    entries = [
        item
        for item in report["screenshots"]
        if args.include_errors or item.get("status") == "ok"
    ]
    if not entries:
        raise SystemExit("no screenshots available for APNG generation")

    frames: list[Image.Image] = []
    total = len(entries)
    for index, entry in enumerate(entries, start=1):
        with Image.open(entry["screenshot"]) as image:
            normalized = normalize(image, (args.width, args.height))
        frames.append(draw_label(normalized, entry["title"], index, total))

    apng_path = args.capture_dir / "evalsmith-ui-tour.png"
    frames[0].save(
        apng_path,
        save_all=True,
        append_images=frames[1:],
        duration=args.duration,
        loop=0,
        format="PNG",
        optimize=True,
    )

    sheet_path = args.capture_dir / "evalsmith-ui-contact-sheet.png"
    build_contact_sheet(entries, sheet_path)
    print(json.dumps({"apng": str(apng_path), "contact_sheet": str(sheet_path), "frames": len(frames)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
