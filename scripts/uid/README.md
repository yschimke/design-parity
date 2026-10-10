# Shared UID evidence tools

These tools run locally or from the reusable UID parity and audit workflows.
They require Python 3.12 and Pillow 12.3.0. Apps keep their capture plan,
UID designs, Compose code and app interaction tests.

```sh
python scripts/uid/evidence.py --plan /app/adaptive-uid-pilot/references.json --root /app/adaptive-uid-pilot/build/pilot
python scripts/uid/package.py --pilot-directory /app/adaptive-uid-pilot --output /app/adaptive-uid-pilot/build/screens.zip
python -m unittest discover -s scripts/uid -p 'test_*.py'
```

The reference publisher's `compose-ui-builder-references/v1` plan determines
capture IDs and sizes. The plan may additionally declare `distinctCaptures`,
an array of two-ID arrays. Each pair must differ in both candidate and reference
pixels; use this to catch accidentally duplicated selection states. There is no
fixed capture count or tablet breakpoint in these tools.

`evidence.py --stage DIRECTORY` stages only the plan's bounded PNGs and a
`previews.json` handoff for the audit. The credentialed audit uses a trusted
pinned copy of this tool and a default-branch plan, never PR scripts. The image
cap remains 1800 pixels per dimension, with an 8 MB per-file read limit.
