"""Build the sticky UID parity PR comment from PR and base evidence artifacts.

Inputs are untrusted artifact files written by a pull request's run. They are
parsed as JSON and bounded PNGs only (through evidence.py's readers); nothing
in them is executed, and every capture ID is revalidated before it reaches a
path or the comment.
"""
import argparse
import html
import importlib.util
import io
import json
import re
from pathlib import Path

from PIL import Image, ImageChops

_spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('evidence.py'))
evidence = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evidence)

SCHEMA = 'adaptive-uid-evidence/v1'
# The producer's capture-ID contract (evidence.py); length is bounded by the body budget instead.
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*')
THUMB_WIDTH = 360
SHA256 = re.compile(r'[0-9a-f]{64}')
# GitHub rejects comment bodies over 65,536 characters; rows past this are counted, not listed.
MAX_ROWS = 200
MAX_BODY = 60_000


def load(root):
    """Captures by ID from an evidence directory, or None when there is none."""
    if root is None or not (root / 'evidence.json').is_file():
        return None
    report = json.loads(evidence.read(root, 'evidence.json'))
    if report.get('schema') != SCHEMA:
        raise ValueError('Unexpected evidence schema')
    if not isinstance(report.get('captures'), list) or not report['captures']:
        raise ValueError('Evidence lists no captures')
    captures = {}
    for capture in report['captures']:
        pid = capture['previewId']
        if not isinstance(pid, str) or not ID.fullmatch(pid) or pid in captures:
            raise ValueError('Invalid or duplicate capture ID')
        changed, total = capture['changedPixels'], capture['totalPixels']
        if type(changed) is not int or type(total) is not int or not 0 <= changed <= total or total == 0:
            raise ValueError(f'Invalid pixel counts: {pid}')
        if not all(isinstance(capture[k], str) and SHA256.fullmatch(capture[k]) for k in ('referenceSha256', 'candidateSha256')):
            raise ValueError(f'Invalid digest: {pid}')
        captures[pid] = capture
    return captures


def exact(captures):
    return sum(c['changedPixels'] == 0 for c in captures.values())


def changes(pr, base):
    """Captures whose reference, candidate or presence differs from base."""
    rows = []
    for pid, now in pr.items():
        before = base.get(pid) if base is not None else None
        sides = []
        if before is None:
            if base is not None:
                sides.append('new')
        else:
            if now['referenceSha256'] != before['referenceSha256']:
                sides.append('reference')
            if now['candidateSha256'] != before['candidateSha256']:
                sides.append('candidate')
        if sides or (base is None and now['changedPixels']):
            rows.append((pid, sides, before, now))
    removed = sorted(set(base or {}) - set(pr))
    return rows, removed


def verified(root, relative, sha256):
    """The PNG at `relative`, only if its bytes match the digest evidence.json recorded."""
    data = evidence.read(root, relative)
    if evidence.digest(data) != sha256:
        raise ValueError(f'Image does not match its recorded digest: {relative}')
    image = Image.open(io.BytesIO(data))
    if image.format != 'PNG' or max(image.size) > 1800:
        raise ValueError(f'Unexpected PNG: {relative}')
    return image.convert('RGBA')


def changed_mask(reference, candidate):
    """The exact-RGBA mask evidence.py uses, recomputed from verified captures."""
    if reference.size != candidate.size:
        raise ValueError('Reference and candidate sizes differ')
    delta = ImageChops.difference(reference, candidate)
    return ImageChops.lighter(ImageChops.lighter(delta.getchannel('R'), delta.getchannel('G')),
                              ImageChops.lighter(delta.getchannel('B'), delta.getchannel('A'))).point(lambda v: 255 if v else 0)


def diff_image(reference, candidate):
    heatmap = Image.new('RGBA', reference.size, 'white')
    heatmap.paste((210, 0, 100, 255), mask=changed_mask(reference, candidate))
    return heatmap


def verify_counts(root, captures):
    """Recompute every capture's pixel counts from its digest-verified images.

    The PR's evidence.json is untrusted; the comment reports only what the
    verified pixels show, and evidence whose counts disagree is rejected.
    """
    references = {r['previewId']: r['raster']['path'] for r in json.loads(evidence.read(root, 'references/index.json'))['references']}
    for pid, capture in captures.items():
        if pid not in references:
            raise ValueError(f'No reference recorded for {pid}')
        reference = verified(root, references[pid], capture['referenceSha256'])
        candidate = verified(root, f'previews/{pid}.png', capture['candidateSha256'])
        changed = changed_mask(reference, candidate).histogram()[255]
        if (changed, reference.width * reference.height) != (capture['changedPixels'], capture['totalPixels']):
            raise ValueError(f'Recorded pixel counts do not match the images: {pid}')


def save_thumbnail(image, out):
    """Fit within THUMB_WIDTH x 2*THUMB_WIDTH, keeping the aspect ratio, never upscaling."""
    bound = (THUMB_WIDTH, 2 * THUMB_WIDTH)
    scale = min(1, bound[0] / image.width, bound[1] / image.height)
    if scale < 1:
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))))
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, optimize=True)


def publish(root, rows, out, limit):
    """Write reference/diff/candidate thumbnails for the first `limit` rows.

    Reference and candidate bytes must match the digests the table was built from,
    and the diff is redrawn from them, so the images cannot contradict the counts.
    """
    references = {r['previewId']: r['raster']['path'] for r in json.loads(evidence.read(root, 'references/index.json'))['references']}
    published = []
    for pid, _, _, now in rows[:limit]:
        reference = verified(root, references[pid], now['referenceSha256'])
        candidate = verified(root, f'previews/{pid}.png', now['candidateSha256'])
        for kind, image in (('reference', reference), ('diff', diff_image(reference, candidate)), ('candidate', candidate)):
            save_thumbnail(image, out / pid / f'{kind}.png')
        published.append(pid)
    return published


def body(marker, pr, base, rows, removed, published, image_base, run_url, max_rows=MAX_ROWS, image_suffix=''):
    total = len(pr)
    headline = f'**{exact(pr)}/{total} exact**'
    if base is not None:
        headline += f' (base: {exact(base)}/{len(base)})'
    lines = [f'<!-- {marker} -->', '### UID parity', '',
             f'{headline}. Pixel differences are advisory; missing or invalid evidence fails the parity job.', '']
    if base is None and rows:
        lines += ['No base evidence was found, so this lists every capture with a pixel difference.', '']
    if not rows and not removed:
        lines.append('No capture changed against base.' if base is not None else 'No capture has a pixel difference.')
    else:
        lines += ['| Capture | Changed | Differing pixels |', '| --- | --- | --- |']
        # Removed captures exist only in base evidence, so they are listed before changed ones.
        shown_removed = removed[:max_rows]
        for pid in shown_removed:
            lines.append(f'| `{pid}` | removed | — |')
        shown_rows = rows[:max_rows - len(shown_removed)]
        for pid, sides, before, now in shown_rows:
            was = f"{before['changedPixels']:,} → " if before is not None else ''
            lines.append(f"| `{pid}` | {', '.join(sides) or '—'} | {was}{now['changedPixels']:,} |")
        if len(removed) > len(shown_removed):
            lines += ['', f'{len(removed) - len(shown_removed)} more removed captures are only in the base run\'s evidence.']
        if len(rows) > len(shown_rows):
            lines += ['', f'{len(rows) - len(shown_rows)} more changed captures are listed in the evidence artifact.']
    if published:
        lines += ['', '<details><summary>Reference · diff · candidate</summary>', '']
        for pid in published:
            cells = ''.join(f'<td><img src="{html.escape(f"{image_base}/{pid}/{kind}.png{image_suffix}", quote=True)}" alt="{kind}"></td>' for kind in ('reference', 'diff', 'candidate'))
            lines.append(f'<b><code>{pid}</code></b><table><tr>{cells}</tr></table>')
        if len(rows) > len(published):
            lines.append(f'{len(rows) - len(published)} more changed captures are in the evidence artifact.')
        lines += ['', '</details>']
    if run_url:
        lines += ['', f'Full evidence: [parity run]({run_url}) → `index.html` in the evidence artifact.']
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--pr', type=Path, required=True)
    parser.add_argument('--base', type=Path)
    parser.add_argument('--marker', required=True)
    parser.add_argument('--image-base', default='')
    # e.g. '?raw=true' for repository-relative ../blob/<ref>/<path> links, which honour private access
    parser.add_argument('--image-suffix', default='')
    parser.add_argument('--images-out', type=Path)
    parser.add_argument('--run-url', default='')
    parser.add_argument('--limit', type=int, default=12)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9:-]+', args.marker):
        raise ValueError('Invalid marker')
    if args.limit < 0:
        raise ValueError('--limit must not be negative')
    pr = load(args.pr)
    if pr is None:
        where = f'; see the [parity run]({args.run_url})' if args.run_url else ''
        args.output.write_text(f'<!-- {args.marker} -->\n### UID parity\n\nThis run produced no evidence{where}.\n')
        return
    verify_counts(args.pr, pr)
    base = load(args.base)
    if base is not None:
        verify_counts(args.base, base)
    rows, removed = changes(pr, base)
    published = publish(args.pr, rows, args.images_out, args.limit) if args.images_out and args.image_base else []
    # Stay under GitHub's body limit however long the IDs: drop thumbnails, then halve the table.
    text = body(args.marker, pr, base, rows, removed, published, args.image_base, args.run_url, image_suffix=args.image_suffix)
    max_rows = MAX_ROWS
    while len(text) > MAX_BODY:
        if not published and max_rows == 0:
            raise ValueError('Comment body exceeds the GitHub limit without any rows')
        published, max_rows = [], (max_rows if published else max_rows // 2)
        text = body(args.marker, pr, base, rows, removed, published, args.image_base, args.run_url, max_rows, args.image_suffix)
    args.output.write_text(text)


if __name__ == '__main__':
    main()
