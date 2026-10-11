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

from PIL import Image

_spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('evidence.py'))
evidence = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evidence)

SCHEMA = 'adaptive-uid-evidence/v1'
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*')
THUMB_WIDTH = 360
# GitHub rejects comment bodies over 65,536 characters; rows past this are counted, not listed.
MAX_ROWS = 200


def load(root):
    """Captures by ID from an evidence directory, or None when there is none."""
    if root is None or not (root / 'evidence.json').is_file():
        return None
    report = json.loads(evidence.read(root, 'evidence.json'))
    if report.get('schema') != SCHEMA:
        raise ValueError('Unexpected evidence schema')
    captures = {}
    for capture in report['captures']:
        pid = capture['previewId']
        if not isinstance(pid, str) or not ID.fullmatch(pid) or pid in captures:
            raise ValueError('Invalid or duplicate capture ID')
        changed, total = capture['changedPixels'], capture['totalPixels']
        if not (isinstance(changed, int) and isinstance(total, int) and 0 <= changed <= total):
            raise ValueError(f'Invalid pixel counts: {pid}')
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


def thumbnail(root, relative, out):
    data = evidence.read(root, relative)
    image = Image.open(io.BytesIO(data))
    if image.format != 'PNG' or max(image.size) > 1800:
        raise ValueError(f'Unexpected PNG: {relative}')
    image.load()
    if image.width > THUMB_WIDTH:
        image = image.resize((THUMB_WIDTH, max(1, round(image.height * THUMB_WIDTH / image.width))))
    out.parent.mkdir(parents=True, exist_ok=True)
    image.convert('RGBA').save(out, optimize=True)


def publish(root, rows, out, limit):
    """Write reference/diff/candidate thumbnails for the first `limit` rows."""
    references = {r['previewId']: r['raster']['path'] for r in json.loads(evidence.read(root, 'references/index.json'))['references']}
    published = []
    for pid, _, _, _ in rows[:limit]:
        for kind, relative in (('reference', references[pid]), ('diff', f'diffs/{pid}.png'), ('candidate', f'previews/{pid}.png')):
            thumbnail(root, relative, out / pid / f'{kind}.png')
        published.append(pid)
    return published


def body(marker, pr, base, rows, removed, published, image_base, run_url):
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
        for pid, sides, before, now in rows[:MAX_ROWS]:
            was = f"{before['changedPixels']:,} → " if before is not None else ''
            lines.append(f"| `{pid}` | {', '.join(sides) or '—'} | {was}{now['changedPixels']:,} |")
        for pid in removed[:max(0, MAX_ROWS - len(rows))]:
            lines.append(f'| `{pid}` | removed | — |')
        omitted = len(rows) + len(removed) - MAX_ROWS
        if omitted > 0:
            lines += ['', f'{omitted} more changed captures are listed in the evidence artifact.']
    if published:
        lines += ['', '<details><summary>Reference · diff · candidate</summary>', '']
        for pid in published:
            cells = ''.join(f'<td><img src="{html.escape(f"{image_base}/{pid}/{kind}.png", quote=True)}" width="240" alt="{kind}"></td>' for kind in ('reference', 'diff', 'candidate'))
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
    parser.add_argument('--images-out', type=Path)
    parser.add_argument('--run-url', default='')
    parser.add_argument('--limit', type=int, default=12)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9:-]+', args.marker):
        raise ValueError('Invalid marker')
    pr = load(args.pr)
    if pr is None:
        args.output.write_text(f'<!-- {args.marker} -->\n### UID parity\n\nThis run produced no evidence; see the [parity run]({args.run_url}).\n')
        return
    base = load(args.base)
    rows, removed = changes(pr, base)
    published = publish(args.pr, rows, args.images_out, args.limit) if args.images_out and args.image_base else []
    args.output.write_text(body(args.marker, pr, base, rows, removed, published, args.image_base, args.run_url))


if __name__ == '__main__':
    main()
