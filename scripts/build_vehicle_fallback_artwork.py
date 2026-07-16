#!/usr/bin/env python3
"""Build normalized, transparent fallback artwork for Riviamigo vehicle surfaces.

The source renderings in ``assets/vehicles_generated`` are intentionally kept as
received. This script removes their flat white matte and composes four stable
presentation canvases per model:

* overview: portrait overhead artwork that matches the API rotation contract
* charging: a charge-port-end crop composed for the charging connection chip
* health: a normalized three-quarter hero composition
* vehicle-card: a compact full side profile for vehicle lists and pickers

The output is deterministic and includes a machine-readable manifest plus an
optional contact sheet for review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Literal

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

MODEL_NAMES = ("r1s", "r1t", "r2s")
Usage = Literal["overview", "charging", "health", "vehicle-card"]

SOURCE_BY_USAGE: dict[Usage, str] = {
    "overview": "top.png",
    "charging": "charge.png",
    "health": "three_quarter.png",
    "vehicle-card": "side.png",
}

CANVAS_BY_USAGE: dict[Usage, tuple[int, int]] = {
    "overview": (640, 1440),
    "charging": (1200, 900),
    "health": (1600, 900),
    "vehicle-card": (1200, 560),
}

# Each charge source keeps its charge-port end on the left side of the image.
# For R1 vehicles that is the front quarter; for R2S it is the rear quarter.
# Keep the port, cable, adjacent wheel, and one neighboring door while discarding
# the rest of the full-vehicle side profile.
CHARGING_PORT_FRACTION: dict[str, float] = {
    "r1s": 0.49,
    "r1t": 0.47,
    "r2s": 0.50,
}


@dataclass(frozen=True)
class AssetReport:
    model: str
    usage: Usage
    source: str
    output: str
    width: int
    height: int
    alpha_coverage: float
    visible_bbox: tuple[int, int, int, int] | None
    sha256: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("assets/vehicles_generated"),
        help="Directory containing model source folders.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("apps/web/public/vehicle-images/fallbacks"),
        help="Directory for generated WebP artwork and manifest.",
    )
    parser.add_argument(
        "--preview",
        type=Path,
        default=None,
        help="Optional contact-sheet path.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Regenerate in a temporary directory and fail when checked-in output differs.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    output = args.output.resolve()

    if args.check:
        with tempfile.TemporaryDirectory(prefix="vehicle-artwork-") as temp_dir:
            generated = Path(temp_dir) / "fallbacks"
            reports = build_all(root, generated)
            write_manifest(generated, reports)
            differences = compare_directories(generated, output)
            if differences:
                print("Vehicle fallback artwork is out of date:")
                for difference in differences:
                    print(f"  - {difference}")
                print("Run scripts/build_vehicle_fallback_artwork.py and commit the generated files.")
                return 1
            print(f"Vehicle fallback artwork is current ({len(reports)} assets).")
            return 0

    reports = build_all(root, output)
    write_manifest(output, reports)
    if args.preview is not None:
        write_contact_sheet(output, reports, args.preview.resolve())
    print(f"Generated {len(reports)} normalized fallback assets in {output}")
    return 0


def build_all(root: Path, output: Path) -> list[AssetReport]:
    validate_sources(root)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    reports: list[AssetReport] = []
    for model in MODEL_NAMES:
        model_output = output / model
        model_output.mkdir(parents=True, exist_ok=True)
        for usage, source_name in SOURCE_BY_USAGE.items():
            source_path = root / model / source_name
            cleaned = remove_white_matte(Image.open(source_path))
            composed = compose_usage(cleaned, model=model, usage=usage)
            output_name = "side" if usage == "vehicle-card" else usage
            output_path = model_output / f"{output_name}.webp"
            composed.save(output_path, "WEBP", lossless=True, method=6, exact=True)
            reports.append(report_asset(root, output, model, usage, source_path, output_path, composed))
    return reports


def validate_sources(root: Path) -> None:
    missing = [
        root / model / source
        for model in MODEL_NAMES
        for source in SOURCE_BY_USAGE.values()
        if not (root / model / source).is_file()
    ]
    if missing:
        paths = "\n".join(f"  - {path}" for path in missing)
        raise SystemExit(f"Missing vehicle artwork sources:\n{paths}")


def remove_white_matte(source: Image.Image) -> Image.Image:
    """Remove only the edge-connected white matte and decontaminate its fringe."""

    rgb = source.convert("RGB")
    rgba = rgb.convert("RGBA")
    width, height = rgba.size

    seeds = {
        (0, 0),
        (width - 1, 0),
        (0, height - 1),
        (width - 1, height - 1),
        (width // 2, 0),
        (width // 2, height - 1),
        (0, height // 2),
        (width - 1, height // 2),
    }
    for seed in seeds:
        # The source matte is flat white. Flood fill keeps white details inside
        # the vehicle because they are not connected to an image edge.
        ImageDraw.floodfill(rgba, seed, (255, 255, 255, 0), thresh=30)

    alpha = rgba.getchannel("A")
    transparent = alpha.point(lambda value: 255 if value == 0 else 0)
    edge_band = transparent.filter(ImageFilter.MaxFilter(11))

    red, green, blue = rgb.split()
    red_darkness = ImageChops.invert(red)
    green_darkness = ImageChops.invert(green)
    blue_darkness = ImageChops.invert(blue)
    darkness = ImageChops.lighter(red_darkness, ImageChops.lighter(green_darkness, blue_darkness))
    soft_alpha = darkness.point(_soft_alpha_from_darkness)
    alpha = Image.composite(soft_alpha, alpha, edge_band)

    cleaned = rgb.convert("RGBA")
    cleaned.putalpha(alpha)
    return decontaminate_white_fringe(cleaned)


def _soft_alpha_from_darkness(value: int) -> int:
    low = 3
    high = 34
    if value <= low:
        return 0
    if value >= high:
        return 255
    t = (value - low) / (high - low)
    # Smoothstep keeps the anti-aliased silhouette gradual without leaving a
    # bright one-pixel outline on dark application surfaces.
    t = t * t * (3.0 - 2.0 * t)
    return round(t * 255)


def decontaminate_white_fringe(image: Image.Image) -> Image.Image:
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if alpha == 255:
                continue
            opacity = alpha / 255.0
            pixels[x, y] = (
                _unblend_white(red, opacity),
                _unblend_white(green, opacity),
                _unblend_white(blue, opacity),
                alpha,
            )
    return image


def _unblend_white(channel: int, opacity: float) -> int:
    if opacity <= 0:
        return 0
    foreground = (channel - 255.0 * (1.0 - opacity)) / opacity
    return max(0, min(255, round(foreground)))


def compose_usage(image: Image.Image, *, model: str, usage: Usage) -> Image.Image:
    if usage == "overview":
        return compose_overview(image)
    if usage == "charging":
        return compose_charging(image, model=model)
    if usage == "health":
        return compose_health(image)
    if usage == "vehicle-card":
        return compose_vehicle_card(image)
    raise AssertionError(f"Unsupported usage: {usage}")


def compose_overview(image: Image.Image) -> Image.Image:
    canvas_size = CANVAS_BY_USAGE["overview"]
    content = crop_visible(image, padding_fraction=0.012)
    return place_on_canvas(
        content,
        canvas_size,
        max_width_fraction=0.86,
        max_height_fraction=0.90,
        center_x_fraction=0.50,
        bottom_fraction=0.95,
    )


def compose_health(image: Image.Image) -> Image.Image:
    canvas_size = CANVAS_BY_USAGE["health"]
    content = crop_visible(image, padding_fraction=0.018)
    return place_on_canvas(
        content,
        canvas_size,
        max_width_fraction=0.90,
        max_height_fraction=0.82,
        center_x_fraction=0.52,
        bottom_fraction=0.95,
    )


def compose_vehicle_card(image: Image.Image) -> Image.Image:
    canvas_size = CANVAS_BY_USAGE["vehicle-card"]
    content = crop_visible(image, padding_fraction=0.012)
    return place_on_canvas(
        content,
        canvas_size,
        max_width_fraction=0.94,
        max_height_fraction=0.82,
        center_x_fraction=0.50,
        bottom_fraction=0.91,
    )


def compose_charging(image: Image.Image, *, model: str) -> Image.Image:
    bbox = alpha_bbox(image)
    if bbox is None:
        raise ValueError(f"Charging source for {model} has no visible pixels")

    left, top, right, bottom = bbox
    visible_width = right - left
    visible_height = bottom - top
    crop_right = min(image.width, math.ceil(left + visible_width * CHARGING_PORT_FRACTION[model]))
    pad_x = max(8, round(visible_width * 0.012))
    pad_y = max(8, round(visible_height * 0.035))
    content = image.crop(
        (
            max(0, left - pad_x),
            max(0, top - pad_y),
            min(image.width, crop_right + pad_x),
            min(image.height, bottom + pad_y),
        )
    )

    canvas_width, canvas_height = CANVAS_BY_USAGE["charging"]
    target_height = round(canvas_height * 0.92)
    scale = target_height / content.height
    target_width = round(content.width * scale)
    resized = content.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
    # Let the vehicle body beyond the charge-port quarter extend past the right
    # edge. This pins the port and adjacent wheel near the chip's visual focus
    # while the cable recedes under the left-side information gradient.
    paste_x = round(canvas_width * 0.33)
    paste_y = round(canvas_height * 0.96) - target_height
    canvas.alpha_composite(resized, (paste_x, paste_y))
    return canvas


def crop_visible(image: Image.Image, *, padding_fraction: float) -> Image.Image:
    bbox = alpha_bbox(image)
    if bbox is None:
        raise ValueError("Artwork has no visible pixels after matte removal")
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    pad_x = max(4, round(width * padding_fraction))
    pad_y = max(4, round(height * padding_fraction))
    return image.crop(
        (
            max(0, left - pad_x),
            max(0, top - pad_y),
            min(image.width, right + pad_x),
            min(image.height, bottom + pad_y),
        )
    )


def place_on_canvas(
    content: Image.Image,
    canvas_size: tuple[int, int],
    *,
    max_width_fraction: float,
    max_height_fraction: float,
    center_x_fraction: float,
    bottom_fraction: float,
) -> Image.Image:
    canvas_width, canvas_height = canvas_size
    max_width = canvas_width * max_width_fraction
    max_height = canvas_height * max_height_fraction
    scale = min(max_width / content.width, max_height / content.height)
    target_width = max(1, round(content.width * scale))
    target_height = max(1, round(content.height * scale))
    resized = content.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    center_x = round(canvas_width * center_x_fraction)
    bottom = round(canvas_height * bottom_fraction)
    paste_x = center_x - target_width // 2
    paste_y = bottom - target_height
    canvas.alpha_composite(resized, (paste_x, paste_y))
    return canvas


def alpha_bbox(image: Image.Image, threshold: int = 6) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > threshold else 0)
    return mask.getbbox()


def report_asset(
    root: Path,
    output_root: Path,
    model: str,
    usage: Usage,
    source_path: Path,
    output_path: Path,
    image: Image.Image,
) -> AssetReport:
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    opaque_weight = sum(index * count for index, count in enumerate(histogram))
    alpha_coverage = opaque_weight / (255 * image.width * image.height)
    return AssetReport(
        model=model.upper(),
        usage=usage,
        source=source_path.relative_to(root.parent).as_posix(),
        output=output_path.relative_to(output_root).as_posix(),
        width=image.width,
        height=image.height,
        alpha_coverage=round(alpha_coverage, 6),
        visible_bbox=alpha_bbox(image),
        sha256=hashlib.sha256(output_path.read_bytes()).hexdigest(),
    )


def write_manifest(output: Path, reports: Iterable[AssetReport]) -> None:
    payload = {
        "version": 1,
        "background": "transparent",
        "format": "lossless-webp",
        "assets": [asdict(report) for report in reports],
    }
    (output / "manifest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def compare_directories(generated: Path, checked_in: Path) -> list[str]:
    generated_files = {
        path.relative_to(generated).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in generated.rglob("*")
        if path.is_file()
    }
    checked_in_files = {
        path.relative_to(checked_in).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in checked_in.rglob("*")
        if path.is_file()
    } if checked_in.exists() else {}

    differences: list[str] = []
    for path in sorted(generated_files.keys() | checked_in_files.keys()):
        if path not in checked_in_files:
            differences.append(f"missing checked-in file: {path}")
        elif path not in generated_files:
            differences.append(f"unexpected checked-in file: {path}")
        elif generated_files[path] != checked_in_files[path]:
            differences.append(f"content differs: {path}")
    return differences


def write_contact_sheet(output: Path, reports: list[AssetReport], preview_path: Path) -> None:
    tile_width = 560
    tile_height = 390
    label_height = 54
    columns = 3
    rows = math.ceil(len(reports) / columns)
    sheet = checkerboard((columns * tile_width, rows * (tile_height + label_height)), 24)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, report in enumerate(reports):
        row, column = divmod(index, columns)
        x = column * tile_width
        y = row * (tile_height + label_height)
        image = Image.open(output / report.output).convert("RGBA")
        preview = image.copy()
        preview.thumbnail((tile_width - 28, tile_height - 28), Image.Resampling.LANCZOS)
        paste_x = x + (tile_width - preview.width) // 2
        paste_y = y + (tile_height - preview.height) // 2
        sheet.alpha_composite(preview, (paste_x, paste_y))
        draw.rectangle((x, y + tile_height, x + tile_width, y + tile_height + label_height), fill=(246, 246, 246, 255))
        label = f"{report.model} · {report.usage} · {report.width}×{report.height} · alpha {report.alpha_coverage:.3f}"
        draw.text((x + 10, y + tile_height + 10), label, fill=(20, 20, 20, 255), font=font)
        draw.text((x + 10, y + tile_height + 29), report.output, fill=(70, 70, 70, 255), font=font)

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(preview_path, "PNG", optimize=True)


def checkerboard(size: tuple[int, int], cell: int) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size, (244, 244, 244, 255))
    draw = ImageDraw.Draw(image)
    alternate = (222, 222, 222, 255)
    for y in range(0, height, cell):
        for x in range(0, width, cell):
            if ((x // cell) + (y // cell)) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=alternate)
    return image


if __name__ == "__main__":
    raise SystemExit(main())
