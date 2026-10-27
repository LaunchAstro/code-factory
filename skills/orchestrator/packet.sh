#!/bin/zsh
# packet.sh OWNER/REPO [OWNER/REPO ...] : print one line per open pull request for the handover packet:
# number, full head SHA, labels, each required check by name with its bucket, and the UTC time observed.
# A check list gh cannot read prints UNKNOWN; UNKNOWN is never green. A repository gh cannot list
# prints PACKET-ERROR and the script exits 1: the packet is then incomplete.
rc=0
for repo in "$@"; do
  prs=$(gh pr list -R "$repo" --state open --limit 1000 --json number,headRefOid,labels \
    -q '.[] | "\(.number) \(.headRefOid) \([.labels[].name] | join(",") | if . == "" then "none" else . end)"') \
    || { echo "PACKET-ERROR $repo: gh pr list failed"; rc=1; continue; }
  [[ -z $prs ]] && { echo "PR $repo none open observed=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; continue; }
  while read -r n h l; do
    c=$(gh pr checks "$n" -R "$repo" --required --json name,bucket -q 'map("\(.name)=\(.bucket)") | join("; ")' 2>/dev/null)
    e=$?; (( e == 0 || e == 8 )) || c=""
    echo "PR $repo#$n head=$h labels=$l required=[${c:-UNKNOWN}] observed=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  done <<< "$prs"
done
exit $rc
