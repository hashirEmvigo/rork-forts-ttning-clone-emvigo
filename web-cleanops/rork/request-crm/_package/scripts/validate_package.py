#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []

for path in ROOT.rglob('*.json'):
    try:
        json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'{path.relative_to(ROOT)}: {exc}')

# Basic referential checks
try:
    actions = json.loads((ROOT / 'mock-data/automation-candidates.seed.json').read_text(encoding='utf-8'))
    action_keys = {a['key'] for a in actions}
    events = json.loads((ROOT / 'mock-data/domain-events.seed.json').read_text(encoding='utf-8'))
    for event in events:
        if event['key'] not in action_keys and event['key'] not in {'request.created'}:
            errors.append(f"domain event {event['key']} has no automation candidate")
except Exception as exc:
    errors.append(f'referential check failed: {exc}')

if errors:
    print('VALIDATION FAILED')
    for err in errors:
        print('-', err)
    raise SystemExit(1)

print('VALIDATION OK')
