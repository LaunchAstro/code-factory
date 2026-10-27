#!/usr/bin/env python3
"""Sol's uncommitted PR 215 proofs; all gate reads use a stand-in gh."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'orchestration/tests/fixtures/trust-gate'
GATE = ROOT / 'orchestration/trust-gate/trust-gate.sh'

STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, re, sys
args = sys.argv[1:]
fx = pathlib.Path(os.environ['SOL_FX'])
if args[:1] != ['api']:
    sys.exit(1)
if args[1].startswith('orgs/test-org/members'):
    print((fx / 'members.json').read_text())
    sys.exit(0)
if args[1] != 'graphql':
    sys.exit(1)
q = next(a[6:] for a in args if a.startswith('query='))
if os.environ.get('SOL_REDIRECT') and re.search(r'followRenames\s*:\s*false', q):
    sys.exit(1)
kind = next(k for k in ['reviewThreads', 'reviews', 'comments'] if k + '(first' in q)
filename = {'reviewThreads': 'threads', 'reviews': 'reviews', 'comments': 'comments'}[kind]
pages = json.loads((fx / (filename + '.json')).read_text())
# GraphQL repository() follows old paths by default. Model an old test-org/r
# path resolving to outside-org/r after a transfer. Return canonical ownership
# only when the query requests it, as the real GraphQL server does.
if os.environ.get('SOL_REDIRECT'):
    for page in pages:
        repo = page['data']['repository']
        if re.search(r'\bowner\s*\{', q):
            repo['owner'] = {'login': 'outside-org', '__typename': 'Organization'}
        if 'nameWithOwner' in q:
            repo['nameWithOwner'] = 'outside-org/r'
print(json.dumps(pages))
'''


def run_gate(mode):
    with tempfile.TemporaryDirectory(prefix='sol-pr215-') as td:
        tmp = Path(td)
        fx = tmp / 'fixtures'
        shutil.copytree(FIXTURES, fx)
        bin_dir = tmp / 'bin'
        bin_dir.mkdir()
        gh = bin_dir / 'gh'
        gh.write_text(STUB)
        gh.chmod(0o755)
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                   SOL_FX=str(fx), TRUST_GATE_ALLOW=str(fx / 'allow.json'))
        if mode == 'malformed':
            valid = json.loads((fx / 'allow.json').read_text())
            invalid = dict(valid, orgs=[], users=[{'login': 'outsider', 'id': 9001}])
            # Two JSON documents: validation sees false then true and exits 0;
            # membership reads use document two, while gate.jq trusts document one.
            (fx / 'allow.json').write_text(json.dumps(invalid) + '\n' + json.dumps(valid))
        else:
            env['SOL_REDIRECT'] = '1'
        result = subprocess.run([str(GATE), 'test-org/r', '1'], env=env,
                                capture_output=True, text=True)
        return result.returncode, json.loads(result.stdout), result.stderr


def malformed():
    rc, out, err = run_gate('malformed')
    leaked = [i['id'] for key in ('comments', 'reviews', 'review_comments')
              for i in out[key] if 'MARKER-OUTSIDE' in i['body']]
    assert rc == 3 and 'refused' in out and not any(out[k] for k in
            ('comments', 'reviews', 'review_comments')), \
        f'malformed multi-document allowlist accepted: exit={rc}, outside items={leaked}, stderr={err.strip()}'


def redirected():
    rc, out, err = run_gate('redirected')
    bots = [i['id'] for key in ('comments', 'reviews', 'review_comments')
            for i in out[key] if i['login'] == 'review-bot']
    assert not bots, \
        f'bot text from outside-org/r trusted through old test-org/r path: exit={rc}, bot items={bots}, stderr={err.strip()}'


TESTS = {
    'Sol proof, criterion 1: malformed multi-document allowlist refuses without outsider text': malformed,
    'Sol proof, criterion 1: redirected outside repository cannot inherit org bot trust': redirected,
}
selected = sys.argv[1:]
if selected and any(name not in TESTS for name in selected):
    raise SystemExit('Unknown test name')
failed = 0
for name in selected or TESTS:
    try:
        TESTS[name]()
        print('PASS ' + name)
    except AssertionError as exc:
        failed += 1
        print('FAIL ' + name + '\n' + str(exc))
raise SystemExit(bool(failed))
