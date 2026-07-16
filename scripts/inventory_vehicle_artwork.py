#!/usr/bin/env python3
"""Inventory source vehicle artwork before normalizing app fallbacks.

The report is intentionally machine-readable so the same measurements can be
used by the production normalizer and its regression tests.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps, ImageStat

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
WHITE_THRESHOLD = 245
ALPHA_VISIBLE_THRESHOLD = 8


def iter_images(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield path


def rounded_color(values: tuple[float, ...]) -> list[int]:
    return [int(round(value)) for value in values[:4]]


def rgba_at(image: Image.Image, x: int, y: int) -> list[int]:
    pixel = image.getpixel((x, y))
    if not isinstance(pixel, tuple):
        pixel = (pixel, pixel, pixel, 255)
    if len(pixel) == 3:
        pixel = (*pixel, 255)
    return [int(value) for value in pixel[:4]]


def ratio_from_histogram(histogram: list[int], start: int, stop: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(sum(histogram[start:stop]) / total, 6)


def alpha_bbox(image: Image.Image) -> list[int] | None:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > ALPHA_VISIBLE_THRESHOLD else 0)
    bbox = mask.getbbox()
    return list(bbox) if bbox else None


def difference_bbox(image: Image.Image, background: tuple[int, int, int, int]) -> list[int] | None:
    background_image = Image.new("RGBA", image.size, background)
    difference = ImageOps.grayscale(Image.fromarray_like(image) if False else Image.new("RGBA", (1, 1)))
    # PIL does not expose a typed helper for this operation, so keep it local.
    from PIL import ImageChops

    difference = ImageChops.difference(image, background_image).convert("L")
    difference = difference.point(lambda value: 255 if value > 12 else 0)
    bbox = difference.getbbox()
    return list(bbox) if bbox else None


def edge_pixels(image: Image.Image) -> Image.Image:
    width, height = image.size
    if width == 1 and height == 1:
        return image.copy()
    strips = [
        image.crop((0, 0, width, 1)),
        image.crop((0, max(0, height - 1), width, height)),
    ]
    if height > 2:
        strips.extend(
            [
                image.crop((0, 1, 1, height - 1)).resize((height - 2, 1)),
                image.crop((max(0, width - 1), 1, width, height - 1)).resize((height - 2, 1)),
            ]
        )
    edge_width = sum(strip.width for strip in strips)
    output = Image.new("RGBA", (edge_width, 1))
    cursor = 0
    for strip in strips:
        normalized = strip if strip.height == 1 else strip.resize((strip.width * strip.height, 1))
        output.paste(normalized, (cursor, 0))
        cursor += normalized.width
    return output


def near_white_ratio(image: Image.Image) -> float:
    rgb = image.convert("RGB")
    channels = rgb.split()
    masks = [channel.point(lambda value: 255 if value >= WHITE_THRESHOLD else 0) for channel in channels]
    from PIL import ImageChops

    mask = ImageChops.multiply(ImageChops.multiply(masks[0], masks[1]), masks[2])
    histogram = mask.histogram()
    total = image.width * image.height
    return round(histogram[255] / total, 6) if total else 0.0


def transparent_ratio(image: Image.Image) -> float:
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    total = image.width * image.height
    return ratio_from_histogram(histogram, 0, 250, total)


def image_entry(path: Path, root: Path) -> dict[str, Any]:
    with Image.open(path) as opened:
        original_mode = opened.mode
        original_format = opened.format
        image = ImageOps.exif_transpose(opened).convert("RGBA")

    width, height = image.size
    corners = [
        rgba_at(image, 0, 0),
        rgba_at(image, max(0, width - 1), 0),
        rgba_at(image, 0, max(0, height - 1)),
        rgba_at(image, max(0, width - 1), max(0, height - 1)),
    ]
    corner_background = tuple(
        int(round(sum(corner[channel] for corner in corners) / len(corners)))
        for channel in range(4)
    )
    edge = edge_pixels(image)
    edge_stats = ImageStat.Stat(edge)

    return {
        "path": path.relative_to(root.parent).as_posix(),
        "relative_to_asset_root": path.relative_to(root).as_posix(),
        "format": original_format,
        "mode": original_mode,
        "width": width,
        "height": height,
        "aspect_ratio": round(width / height, 6) if height else None,
        "has_alpha_channel": "A" in original_mode or "transparency" in opened.info,
        "transparent_ratio": transparent_ratio(image),
        "near_white_ratio": near_white_ratio(image),
        "edge_near_white_ratio": near_white_ratio(edge),
        "edge_mean_rgba": rounded_color(tuple(edge_stats.mean)),
        "corner_rgba": corners,
        "estimated_background_rgba": list(corner_background),
        "alpha_bbox": alpha_bbox(image),
        "difference_bbox": difference_bbox(image, corner_background),
        "bytes": path.stat().st_size,
    }


def checkerboard(size: tuple[int, int], tile: int = 16) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size, ImageColor.getrgb("#ececec"))
    draw = ImageDraw.Draw(image)
    alternate = ImageColor.getrgb("#d8d8d8")
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            if ((x // tile) + (y // tile)) % 2:
                draw.rectangle((x, y, min(width, x + tile - 1), min(height, y + tile - 1)), fill=alternate)
    return image


def build_contact_sheet(entries: list[dict[str, Any]], root: Path, output: Path) -> None:
    if not entries:
        return

    columns = 3
    tile_width = 480
    image_height = 250
    label_height = 70
    tile_height = image_height + label_height
    rows = math.ceil(len(entries) / columns)
    sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "white")
    font = ImageFont.load_default()

    for index, entry in enumerate(entries):
        row, column = divmod(index, columns)
        x = column * tile_width
        y = row * tile_height
        canvas = checkerboard((tile_width, image_height))
        source_path = root.parent / entry["path"]
        with Image.open(source_path) as opened:
            source = ImageOps.exif_transpose(opened).convert("RGBA")
        source.thumbnail((tile_width - 24, image_height - 24), Image.Resampling.LANCZOS)
        paste_x = (tile_width - source.width) // 2
        paste_y = (image_height - source.height) // 2
        canvas.paste(source, (paste_x, paste_y), source)
        sheet.paste(canvas, (x, y))

        draw = ImageDraw.Draw(sheet)
        path_label = entry["relative_to_asset_root"]
        if len(path_label) > 68:
            path_label = f"...{path_label[-65:]}"
        diagnostics = (
            f"{entry['width']}x{entry['height']}  alpha={entry['transparent_ratio']:.3f}  "
            f"white={entry['near_white_ratio']:.3f}  edge-white={entry['edge_near_white_ratio']:.3f}"
        )
        draw.text((x + 8, y + image_height + 8), path_label, fill="black", font=font)
        draw.text((x + 8, y + image_height + 30), diagnostics, fill="black", font=font)

    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, format="PNG", optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("assets"))
    parser.add_argument("--output-dir", type=Path, default=Path("vehicle-artwork-inventory"))
    args = parser.parse_args()

    root = args.root.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    paths = list(iter_images(root))
    entries = [image_entry(path, root) for path in paths]
    report = {
        "asset_root": root.name,
        "image_count": len(entries),
        "images": entries,
    }
    report_path = output_dir / "inventory.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    build_contact_sheet(entries, root, output_dir / "contact-sheet.png")

    print(json.dumps(report, indent=2))
    print(f"Wrote {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
