// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const schemaVersion = 1;
const identityKeys = [
  'projectId',
  'repository',
  'laneId',
  'sessionId',
  'machine',
  'workspaceId',
  'paneId',
  'assignmentId',
];
const assignmentKeys = ['sectionId', 'mapRef', 'specRef', 'ticketRef', 'phase'];
const token = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const repo = /^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const evidenceFields = {
  'pr-opened': ['prRef', 'head'],
  'pr-pushed': ['prRef', 'head'],
  review: ['prRef', 'head', 'verdict'],
  merge: ['prRef', 'head', 'mergeCommit'],
  'switch-on': ['head', 'buildId', 'evidenceRef'],
  'served-build': ['head', 'buildId', 'evidenceRef'],
};
const kindFields = {
  boot: assignmentKeys,
  assignment: assignmentKeys,
  transition: ['transition'],
  activity: ['activity'],
  ...evidenceFields,
};
const sha = /^[a-f0-9]{40}$/;
const phases = ['map', 'tickets', 'spec', 'build'];
const fail = (code) => {
  throw new Error(code);
};
function shape(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    fail('invalid-fields');
}
export function loadProject(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  shape(value, [
    'schemaVersion',
    'projectId',
    'aliases',
    'repositories',
    'sections',
    'sectionSource',
  ]);
  if (
    value.schemaVersion !== 1 ||
    typeof value.projectId !== 'string' ||
    !token.test(value.projectId)
  )
    fail('invalid-project');
  for (const [name, pattern] of [
    ['aliases', token],
    ['repositories', repo],
    ['sections', /^[a-z][a-z0-9-]*$/],
  ]) {
    if (
      !Array.isArray(value[name]) ||
      new Set(value[name]).size !== value[name].length ||
      value[name].some((x) => typeof x !== 'string' || !pattern.test(x))
    )
      fail('invalid-config-membership');
  }
  if (
    !value.repositories.length ||
    (value.sections.length &&
      (typeof value.sectionSource !== 'string' || !value.sectionSource.length))
  )
    fail('missing-config-source');
  if (value.sectionSource !== null && typeof value.sectionSource !== 'string')
    fail('invalid-config-source');
  return value;
}
function reference(value, project) {
  if (value === null) return;
  if (typeof value !== 'string') fail('invalid-reference');
  const match = /^(.*?)#([1-9][0-9]*)$/.exec(value);
  if (!match || !project.repositories.includes(match[1]) || !Number.isSafeInteger(Number(match[2])))
    fail('invalid-reference');
}
export function validateRecord(record, project) {
  if (!record || !Object.hasOwn(kindFields, record.kind)) fail('invalid-kind');
  const extra = kindFields[record.kind];
  shape(record, ['schemaVersion', 'observedAt', 'kind', ...identityKeys, ...extra]);
  if (
    record.schemaVersion !== schemaVersion ||
    typeof record.observedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.observedAt) ||
    new Date(record.observedAt).toISOString() !== record.observedAt
  )
    fail('invalid-envelope');
  for (const key of identityKeys.filter((k) => k !== 'repository'))
    if (typeof record[key] !== 'string' || !token.test(record[key])) fail('invalid-identity');
  if (record.projectId !== project.projectId || !project.repositories.includes(record.repository))
    fail('invalid-membership');
  if (
    record.kind === 'transition' &&
    !['assigned', 'blocked', 'resumed', 'stopped', 'wrapped'].includes(record.transition)
  )
    fail('invalid-transition');
  if (record.kind === 'activity' && record.activity !== 'DONE') fail('invalid-activity');
  if (Object.hasOwn(evidenceFields, record.kind)) {
    if (typeof record.head !== 'string' || !sha.test(record.head)) fail('invalid-head');
    if (Object.hasOwn(record, 'prRef')) {
      reference(record.prRef, project);
      if (record.prRef === null || !record.prRef.startsWith(record.repository + '#'))
        fail('invalid-pr-repository');
    }
    if (
      record.kind === 'review' &&
      !['approved', 'changes-requested', 'commented', 'unknown'].includes(record.verdict)
    )
      fail('invalid-verdict');
    if (
      record.kind === 'merge' &&
      (typeof record.mergeCommit !== 'string' || !sha.test(record.mergeCommit))
    )
      fail('invalid-merge-commit');
    if (['switch-on', 'served-build'].includes(record.kind)) {
      if (
        typeof record.buildId !== 'string' ||
        !token.test(record.buildId) ||
        typeof record.evidenceRef !== 'string' ||
        !/^https:\/\/[^\s?#@]+(?:[/?#][^\s]*)?$/.test(record.evidenceRef) ||
        record.evidenceRef.length > 1024
      )
        fail('invalid-live-evidence');
    }
  }
  if (!['boot', 'assignment'].includes(record.kind)) return record;
  if (record.sectionId !== null && !project.sections.includes(record.sectionId))
    fail('invalid-section');
  if (!phases.includes(record.phase)) fail('invalid-phase');
  for (const key of ['mapRef', 'specRef', 'ticketRef']) reference(record[key], project);
  return record;
}
function advance(state, record) {
  if (!state) {
    if (record.kind !== 'boot') fail('missing-boot');
    state = {
      sessionId: record.sessionId,
      assignment: record,
      assignments: [],
      transition: 'assigned',
      activity: null,
      evidence: [],
    };
  } else {
    for (const key of ['projectId', 'laneId', 'sessionId', 'machine', 'workspaceId', 'paneId'])
      if (record[key] !== state.assignment[key]) fail('identity-conflict');
    if (record.observedAt < state.observedAt) fail('time-conflict');
    if (record.kind === 'boot') fail('duplicate-boot');
  }
  if (['boot', 'assignment'].includes(record.kind)) {
    if (state.assignments.some((a) => a.assignmentId === record.assignmentId))
      fail('assignment-id-reused');
    state.assignments.push(record);
    state.assignment = record;
    state.transition = 'assigned';
    state.activity = null;
  } else {
    const assignment = state.assignments.find((a) => a.assignmentId === record.assignmentId);
    if (!assignment || assignment.repository !== record.repository) fail('unknown-assignment');
    if (record.kind === 'transition') {
      if (record.assignmentId !== state.assignment.assignmentId) fail('inactive-assignment');
      state.transition = record.transition;
    }
    if (record.kind === 'activity') {
      if (record.assignmentId !== state.assignment.assignmentId) fail('inactive-assignment');
      state.activity = record.activity;
    }
    if (Object.hasOwn(evidenceFields, record.kind)) {
      if (
        ['review', 'merge'].includes(record.kind) &&
        !state.evidence.some(
          (e) =>
            ['pr-opened', 'pr-pushed'].includes(e.kind) &&
            e.assignmentId === record.assignmentId &&
            e.prRef === record.prRef &&
            e.head === record.head,
        )
      )
        fail('unobserved-pr-head');
      state.evidence.push(record);
    }
  }
  state.observedAt = record.observedAt;
  state.placement = state.assignment.sectionId === null ? 'unknown' : 'declared';
  return state;
}
export function validateHistory(records, project) {
  const sessions = new Map();
  for (const record of records) {
    validateRecord(record, project);
    sessions.set(record.sessionId, advance(sessions.get(record.sessionId), record));
  }
}
export async function appendDeclaration(dir, project, input) {
  if (Object.hasOwn(input, 'observedAt') || Object.hasOwn(input, 'schemaVersion'))
    fail('writer-owned-envelope');
  const record = validateRecord(
    { ...input, schemaVersion, observedAt: new Date().toISOString() },
    project,
  );
  return { record, compatibility: compatibilityLines(record) };
}
export function compatibilityLines(record) {
  return ['boot', 'assignment'].includes(record.kind)
    ? [
        `${record.observedAt} ${record.laneId} ${record.kind === 'boot' ? 'BOOTED' : 'TICKET'} Section: ${record.sectionId ?? 'none'} Ticket: ${record.ticketRef ?? 'none'}`,
        `${record.observedAt} ${record.laneId} PHASE Phase: ${record.phase}`,
      ]
    : [];
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--dir') fail('usage');
  const project = loadProject(args[1]);
  if (command === 'append')
    return appendDeclaration(args[3], project, JSON.parse(readFileSync(0, 'utf8')));
  fail('unknown-command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(
      'declaration refused: ' +
        (/^[a-z-]+$/.test(error.message) ? error.message : 'invalid-input') +
        '\n',
    );
    process.exitCode = 1;
  }
}
