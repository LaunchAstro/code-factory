#!/usr/bin/env python3
"""Stable Sol finding ids, builder disputes and a close gate that fails closed.

The rules are adapted from the close gate in 37signals' ralph-lisa-loop
(house-skills, MIT, references/guide.md "Close Gate" and "Finding and Dispute
Tracking"); no text is copied. Sol rules disputes here: there is no human
mediator.

prompt: print the rules, the ledger's open ids and the disputes, for the
        reviewer's --checks file. Exit 2 on a bad dispute file.
gate:   parse Sol's comment against the ledger. PASS (exit 0) and HOLD (exit 1)
        write the next ledger; FAIL (exit 3) writes nothing and must block.

Ledgers sit side by side as sol-ledger-<pr>.json: an earlier PR's id closed here
is checked against its own ledger, which is read and never written.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ID = r'S(\d+)-(\d+)'
# Any "criterion:" outside a parsed Finding block is a finding without an id, whatever
# markup surrounds it (indent, quote, list marker, number, emphasis, code). Markup
# includes '_', so the edges are "no letter or digit", never \b.
CRITERION = re.compile(r'(?i)(?<![^\W_])criterion[\W_]{0,4}:')
TERMINAL = ('closed', 'withdrawn')


def load(path, pr):
    if path.exists():
        ledger = json.loads(path.read_text())
        if ledger.get('pr') != pr:
            raise ValueError(f'ledger {path} is for PR {ledger.get("pr")}, not {pr}')
        ledger.setdefault('carried', {})
        return ledger
    return {'pr': pr, 'rounds': [], 'findings': {}, 'disputes': {}, 'carried': {}}


def save(path, ledger):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f'.{path.name}.')
    with os.fdopen(fd, 'w') as out:
        json.dump(ledger, out, indent=1, sort_keys=True)
        out.write('\n')
    os.replace(tmp, path)


def number(fid):
    return int(fid.rsplit('-', 1)[1])


def next_id(ledger):
    return max((number(f) for f in ledger['findings']), default=0) + 1


def open_ids(ledger):
    return sorted((f for f, v in ledger['findings'].items() if v['state'] == 'open'), key=number)


def read_disputes(path, ledger):
    """The builder's disputes on open findings, each with evidence. Refuse anything else."""
    if path is None:
        return {}
    if not path.is_file():
        raise ValueError(f'dispute snapshot {path} is missing')
    disputes, current = {}, None
    for line in path.read_text().splitlines():
        head = re.fullmatch(rf'Dispute: ({ID})\s*', line)
        if head:
            current = head.group(1)
            if current in disputes:
                raise ValueError(f'{current} is disputed twice')
            disputes[current] = {'evidence': '', 'text': [line]}
        elif current:
            disputes[current]['text'].append(line)
            if line.startswith('Evidence:'):
                disputes[current]['evidence'] = line[len('Evidence:'):].strip()
        elif line.strip():
            raise ValueError('text before the first Dispute line')
    for fid, d in disputes.items():
        if ledger['findings'].get(fid, {}).get('state') != 'open':
            raise ValueError(f'{fid} is not an open finding')
        if not d['evidence']:
            raise ValueError(f'{fid} has no Evidence line')
    return disputes


def fed_disputes(ledger, disputes):
    """Disputes Sol must rule on this round: new ones, plus any still open."""
    fed = {f: '\n'.join(d['text']).strip() for f, d in disputes.items()
           if ledger['disputes'].get(f, {}).get('state') in (None, 'open')}
    for fid, d in ledger['disputes'].items():
        if d['state'] == 'open' and fid not in fed:
            fed[fid] = d['text']
    return fed


def reply_disputes(ledger, got, fed):
    """Rulings on open earlier findings with no dispute fed: the builder disputed in a PR reply,
    which Sol reads through the trust gate. A ruling on any other id stays unrequested."""
    return {f: f'{f} disputed in a PR reply comment' for f in got['rulings']
            if f not in fed and ledger['findings'].get(f, {}).get('state') == 'open'}


def earlier_pr_ids(path, ledger, got):
    """Ids from another PR's ledger that this comment closes or withdraws. Each must be open in
    that PR's own ledger beside this one, and not already ended here; anything else is refused."""
    carried, reasons, pr = {}, [], ledger['pr']
    for fid in (*got['closed'], *got['withdrawn']):
        src = int(re.fullmatch(ID, fid).group(1))
        if src == pr or fid in carried:
            continue
        if fid in ledger['carried']:
            reasons.append(f'{fid} was already {ledger["carried"][fid]["state"]} on PR {pr}')
            continue
        source = path.with_name(f'sol-ledger-{src}.json')
        if not source.is_file():
            reasons.append(f'{fid}: no ledger for PR {src} beside this one')
            continue
        try:
            found = load(source, src)['findings'].get(fid)
        except (ValueError, OSError) as err:
            reasons.append(f'{fid}: ledger for PR {src} refused: {err}')
            continue
        if not found or found.get('state') != 'open':
            reasons.append(f'{fid} is not open in the ledger for PR {src}')
            continue
        carried[fid] = {k: found.get(k) for k in ('criterion', 'where', 'claim')} | {'from': source.name}
    return carried, reasons


def prompt(args, ledger):
    disputes = fed_disputes(ledger, read_disputes(args.disputes, ledger))
    pr, nxt = ledger['pr'], next_id(ledger)
    earlier = [f'{f} (criterion {ledger["findings"][f]["criterion"]}, {ledger["findings"][f]["where"]})'
               for f in open_ids(ledger)]
    out = [f"""Finding ids and the close gate (ralph-lisa rules). In addition to the finding format above:
- Each finding you raise starts with its own line `Finding: S{pr}-<n>`, directly above its Criterion line. New findings on this head take S{pr}-{nxt}, S{pr}-{nxt + 1} and so on, in order.
- An earlier finding keeps its id. For each id under "Open earlier findings", write exactly one of: `Closed: <id> <why, naming the proof run>`; `Withdrawn: <id> <why>` (a dispute you upheld, or replaced by a new id you name); or its whole finding block again under the same `Finding: <id>` line if it still holds. Never raise an earlier finding again under a new id without withdrawing the old one.
- An id from an earlier pull request (S<m>-<n>) that this head closes takes only a `Closed:` or `Withdrawn:` line; it is checked against that PR's ledger. Never raise it here as a finding: raise a new id of this PR.
- Each dispute below, and each the builder made in a PR reply on an open earlier id, is the builder's argument, not evidence: check it against the code and run its evidence. Rule on each with one line: `Dispute: <id> upheld <why>` (then also `Withdrawn: <id>`), `Dispute: <id> rejected <why>` (the finding stays: repeat its block or close it), or `Dispute: <id> open <what would decide it>`.
- Directly above the five closing lines, write these two lines, counting from your own blocks:
Open findings: <n> (<ids comma-separated, or none>)
Open disputes: <n> (<ids comma-separated, or none>)
- Approve only when both counts are 0. A comment whose counts or ids disagree with its blocks, or that drops an earlier id, is refused and the merge stays blocked.
Open earlier findings: {', '.join(earlier) or 'none yet'}"""]
    for fid, text in sorted(disputes.items(), key=lambda kv: number(kv[0])):
        out.append(f'Builder dispute on {fid}:\n{text}')
    print('\n'.join(out))
    return 0


def parse(body):
    lines = body.splitlines()
    consumed = set()
    got = {'blocks': {}, 'closed': {}, 'withdrawn': {}, 'rulings': {}, 'counts': {}, 'heads': [],
           'verdicts': [], 'errors': []}
    for i, line in enumerate(lines):
        line = line.strip()
        m = re.fullmatch(rf'Finding: ({ID})', line)
        if m:
            at = [j for j in range(i + 1, min(i + 6, len(lines))) if lines[j].strip()][:3]
            rest = [lines[j].strip() for j in at]
            crit = re.fullmatch(r'Criterion: (\S+)', rest[0]) if rest else None
            if not crit or len(rest) < 3 or not rest[2].startswith('Proof:'):
                got['errors'].append(f'{m.group(1)} has no Criterion, location and Proof under it')
                continue
            consumed.add(at[0])
            if m.group(1) in got['blocks']:
                got['errors'].append(f'{m.group(1)} has two finding blocks')
            got['blocks'][m.group(1)] = {'criterion': crit.group(1), 'where': rest[1].split(' ', 1)[0],
                                         'claim': rest[1].split(' ', 1)[-1][:200]}
            continue
        if i not in consumed and CRITERION.search(lines[i]):
            got['errors'].append(f'finding without an id at comment line {i + 1}')
        for key in ('Closed', 'Withdrawn'):
            m = re.match(rf'{key}: ({ID})\b', line)
            if m:
                got[key.lower()][m.group(1)] = line
        m = re.match(rf'Dispute: ({ID}) (upheld|rejected|open)\b', line)
        if m:
            if m.group(1) in got['rulings']:
                got['errors'].append(f'dispute {m.group(1)} is ruled twice')
            got['rulings'][m.group(1)] = m.group(4)
        m = re.fullmatch(r'Open (findings|disputes): (\d+) \(([^)]*)\)', line)
        if m:
            listed = [x.strip() for x in m.group(3).split(',') if x.strip() and x.strip() != 'none']
            if m.group(1) in got['counts']:
                got['errors'].append(f'two Open {m.group(1)} lines')
            got['counts'][m.group(1)] = (int(m.group(2)), listed)
        m = re.fullmatch(r'Head SHA: ([0-9a-f]{40})', line)
        if m:
            got['heads'].append(m.group(1))
        m = re.fullmatch(r'Verdict: (approve|changes requested)', line)
        if m:
            got['verdicts'].append(m.group(1))
    return got


def check(ledger, got, head, fed):
    reasons = list(got['errors'])
    pr, known = ledger['pr'], ledger['findings']
    if got['heads'][-1:] != [head]:
        reasons.append(f'Head SHA line is not the reviewed head {head}')
    if len(got['verdicts']) != 1:
        reasons.append('no single Verdict line')
    for kind in ('findings', 'disputes'):
        if kind not in got['counts']:
            reasons.append(f'no Open {kind} line')
    for fid in (*got['blocks'], *got['rulings']):
        if not fid.startswith(f'S{pr}-'):
            reasons.append(f'{fid} is not an id of PR {pr}')
    for fid in sorted(set(got['closed']) & set(got['withdrawn']), key=number):
        reasons.append(f'{fid} is both closed and withdrawn')
    new = sorted((f for f in got['blocks'] if f not in known), key=number)
    expected = [f'S{pr}-{n}' for n in range(next_id(ledger), next_id(ledger) + len(new))]
    if new != expected:
        reasons.append(f'new ids {", ".join(new)}: expected {", ".join(expected)}')
    for fid in got['blocks']:
        if known.get(fid, {}).get('state') in TERMINAL:
            reasons.append(f'{fid} was {known[fid]["state"]} and is raised again')
    for key in ('closed', 'withdrawn'):
        for fid in got[key]:
            if not fid.startswith(f'S{pr}-'):
                continue  # earlier_pr_ids carried it or refused it
            if known.get(fid, {}).get('state') != 'open':
                reasons.append(f'{key} {fid} is not an open earlier finding')
            if fid in got['blocks']:
                reasons.append(f'{fid} is both {key} and still listed as a finding')
    for fid in open_ids(ledger):
        if fid not in got['blocks'] and fid not in got['closed'] and fid not in got['withdrawn']:
            reasons.append(f'{fid} vanished: no finding block, Closed or Withdrawn line')
    for fid, ruling in got['rulings'].items():
        if fid not in fed:
            reasons.append(f'dispute ruling on {fid}, which was not disputed')
        elif ruling == 'upheld' and fid not in got['withdrawn']:
            reasons.append(f'dispute {fid} upheld but the finding is not withdrawn')
        elif ruling == 'rejected' and fid in got['withdrawn']:
            reasons.append(f'dispute {fid} rejected but the finding is withdrawn')
    derived = {'findings': sorted(got['blocks'], key=number),
               'disputes': sorted((f for f in fed if got['rulings'].get(f, 'open') == 'open'), key=number)}
    for kind, ids in derived.items():
        if kind not in got['counts']:
            continue
        stated, listed = got['counts'][kind]
        if stated != len(ids):
            reasons.append(f'stated open {kind} {stated}, blocks give {len(ids)} ({", ".join(ids) or "none"})')
        if sorted(listed) != sorted(ids) or len(listed) != stated:
            reasons.append(f'listed open {kind} ({", ".join(listed) or "none"}) differ from {", ".join(ids) or "none"}')
    if got['verdicts'] == ['approve'] and (derived['findings'] or derived['disputes']):
        reasons.append(f'approve with {len(derived["findings"])} open finding(s) and '
                       f'{len(derived["disputes"])} open dispute(s)')
    return reasons, derived


def gate(args, ledger):
    try:
        fed = fed_disputes(ledger, read_disputes(args.disputes, ledger))
    except ValueError as err:
        print(f'FAIL dispute file: {err}')
        return 3
    body = args.comment.read_text() if args.comment.exists() else ''
    got = parse(body)
    fed = {**fed, **reply_disputes(ledger, got, fed)}
    carried, refused = earlier_pr_ids(args.ledger, ledger, got)
    reasons, derived = check(ledger, got, args.head, fed)
    reasons += refused
    if reasons:
        print('FAIL ' + '; '.join(reasons))
        return 3
    rnd = len(ledger['rounds']) + 1
    for fid, block in got['blocks'].items():
        ledger['findings'].setdefault(fid, {**block, 'state': 'open', 'raised_round': rnd})
    for key, state in (('closed', 'closed'), ('withdrawn', 'withdrawn')):
        for fid, line in got[key].items():
            if fid in carried:
                ledger['carried'][fid] = {**carried[fid], 'state': state, 'ended_round': rnd, 'note': line[:300]}
            else:
                ledger['findings'][fid].update(state=state, ended_round=rnd, note=line[:300])
    for fid, text in fed.items():
        ledger['disputes'][fid] = {'state': got['rulings'].get(fid, 'open'), 'round': rnd, 'text': text}
    verdict = got['verdicts'][0]
    ledger['rounds'].append({'round': rnd, 'head': args.head, 'verdict': verdict, 'url': args.url})
    save(args.ledger, ledger)
    word = 'PASS' if verdict == 'approve' else 'HOLD'
    print(f'{word} round {rnd} open findings {len(derived["findings"])} ({", ".join(derived["findings"]) or "none"}) '
          f'open disputes {len(derived["disputes"])} ({", ".join(derived["disputes"]) or "none"})')
    return 0 if word == 'PASS' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('step', choices=('prompt', 'gate'))
    parser.add_argument('--pr', type=int, required=True)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--disputes', type=Path)
    parser.add_argument('--head')
    parser.add_argument('--comment', type=Path)
    parser.add_argument('--url', default='')
    args = parser.parse_args()
    if args.step == 'prompt':
        try:
            return prompt(args, load(args.ledger, args.pr))
        except (ValueError, OSError) as err:
            print(f'refused: {err}', file=sys.stderr)
            return 2
    if not args.head or not args.comment:
        parser.error('gate needs --head and --comment')
    try:
        # One gate at a time per ledger: the read, the check and the write sit under this lock.
        with open(args.ledger.with_name(args.ledger.name + '.lock'), 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return gate(args, load(args.ledger, args.pr))
    except Exception as err:  # anything unexpected must block, never pass
        print(f'FAIL {type(err).__name__}: {err}')
        return 3


if __name__ == '__main__':
    sys.exit(main())
