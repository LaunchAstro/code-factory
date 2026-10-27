#!/bin/zsh
# SPDX-License-Identifier: AGPL-3.0-only
# sol-rl-gate.sh [--repo OWNER/NAME] PR HEAD [COMMENT_URL] [DISPUTE_SNAPSHOT]: ralph-lisa rules gate on Sol's comment for this head (register 45 d).
# Reads only the comment the active gh login posted on OWNER/NAME's PR with "Head SHA: <HEAD>" (default LaunchAstro/ops-astro).
# PASS or HOLD advance the PR's ledger: polish/sol-ledger-<PR>.json for the default repository, polish/<owner>/<name>/sol-ledger-<PR>.json
# (lower case, as GitHub matches names) for any other, so two repositories' PRs with one number never share a ledger or an earlier-PR lookup. Anything else fails
# closed: "Sol verdict" failure on the head in that repository, ledger untouched, one SOL-RULES line in events.log.
# Root: SOL_RL_ROOT, else the folder above this script (the round folder, for the tools-orch copy).
REPO=LaunchAstro/ops-astro
[[ $1 == --repo ]] && { REPO=$2; shift 2; }
R=${SOL_RL_ROOT:-${0:A:h:h}}; N=$1; H=$2; U=$3; D=$4
[[ $REPO =~ '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$' && $REPO != */.* && $N =~ '^[0-9]+$' && $H =~ '^[0-9a-f]{40}$' ]] ||
  { echo "usage: sol-rl-gate.sh [--repo OWNER/NAME] PR FULL_HEAD [COMMENT_URL] [DISPUTE_SNAPSHOT]"; exit 2; }
L=${(L)REPO}
if [[ $L == launchastro/ops-astro ]]; then S=$R/polish; TAG=$N; else S=$R/polish/$L; TAG=$L#$N; fi
mkdir -p $S; B=$S/sol-comment-$N-${H:0:7}.md
me=$(gh api user -q .login 2>/dev/null)
id=$([[ -n $me ]] && gh api "repos/$REPO/issues/$N/comments?per_page=100" --paginate --jq ".[]|select(.user.login==\"$me\" and (.body|contains(\"Head SHA: $H\")))|.id" 2>/dev/null | tail -1)
: > $B; [[ -n $id ]] && gh api repos/$REPO/issues/comments/$id --jq .body > $B 2>/dev/null
g=$(python3 ${0:A:h}/sol_rules.py gate --pr $N --head $H --ledger $S/sol-ledger-$N.json --comment $B --url "$U" ${D:+--disputes} ${D:+$D} 2>&1 | head -1)
case $g in
  PASS*|HOLD*) ;;
  *) g="FAIL-CLOSED ${g:-no gate output}"
     gh api repos/$REPO/statuses/$H -f context="Sol verdict" -f state=failure -f description="Sol rules gate failed closed: events.log SOL-RULES $TAG" >/dev/null 2>&1 || g="$g; Sol verdict status post FAILED" ;;
esac
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) SOL-RULES $TAG head=${H:0:10} $g" >> $R/events.log
echo "$g"
