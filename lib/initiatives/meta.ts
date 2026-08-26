import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { Initiative, InitiativeTask, InitiativeTaskStatus, InitiativeUpdate, TaskMeta } from '@/lib/api/types';

// Category is a lowercase free-form string on the real server ("infrastructure"),
// not the capitalized four-value enum the design handoff implied — keyed
// lowercase here, with the display label carried alongside since the raw
// value is no longer presentable as-is. Only "infrastructure" has been seen
// live; the other three are carried over from the handoff as a best guess
// pending more real category values.
export const INITIATIVE_CATEGORIES: Record<string, { label: string; icon: IconSymbolName }> = {
  infrastructure: { label: 'Infrastructure', icon: 'hammer.fill' },
  environment: { label: 'Environment', icon: 'leaf.fill' },
  community: { label: 'Community', icon: 'person.2.fill' },
  education: { label: 'Education', icon: 'book.fill' },
};

export const INITIATIVE_CATEGORY_ORDER = ['infrastructure', 'environment', 'community', 'education'];

export function initiativeCategoryMeta(category: string): { label: string; icon: IconSymbolName } {
  return INITIATIVE_CATEGORIES[category?.toLowerCase()] ?? { label: category || 'Other', icon: 'ellipsis.circle.fill' };
}

// `color` is a real, independent field on the initiative ("blue") — not
// derived from category the way the handoff assumed. Named-color → hex,
// standard Tailwind 500s; only "blue" confirmed live so far.
export const INITIATIVE_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  green: '#16a34a',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#d97706',
  yellow: '#ca8a04',
  purple: '#7c3aed',
  violet: '#8b5cf6',
  indigo: '#6366f1',
  pink: '#db2777',
  rose: '#e11d48',
  teal: '#0d9488',
  cyan: '#0891b2',
  sky: '#0284c7',
  emerald: '#059669',
  lime: '#65a30d',
  fuchsia: '#c026d3',
  gray: '#64748b',
  grey: '#64748b',
  slate: '#475569',
};

export function initiativeColor(color: string | null | undefined): string {
  return (color && INITIATIVE_COLORS[color.toLowerCase()]) || '#64748b';
}

// Status values are lowercase strings; only "active" has been confirmed live.
// "planning"/"completed" are carried over from the design handoff as a best
// guess — initiativeStatusMeta falls back safely for anything else.
export const INITIATIVE_STATUS_META: Record<string, { label: string; color: string }> = {
  planning: { label: 'Planning', color: '#d97706' },
  active: { label: 'Active', color: '#059669' },
  completed: { label: 'Completed', color: '#64748b' },
};

export const INITIATIVE_STATUS_ORDER = ['planning', 'active', 'completed'];

// `status` coming back off a live response isn't guaranteed to be one of the
// known values — indexing INITIATIVE_STATUS_META directly previously left a
// screen blank when it wasn't (see meta history). Always go through this.
export function initiativeStatusMeta(status: string): { label: string; color: string } {
  return INITIATIVE_STATUS_META[status?.toLowerCase()] ?? INITIATIVE_STATUS_META.planning;
}

// Confirmed live: a task's status is one of these three, hyphenated. No
// evidence of a separate "blocked" concept on the embedded task summary.
export const TASK_STATUS_META: Record<InitiativeTaskStatus, { label: string; color: string }> = {
  todo: { label: 'Not started', color: '#64748b' },
  'in-progress': { label: 'In progress', color: Brand },
  done: { label: 'Done', color: '#059669' },
};

export const TASK_STATUS_ORDER: InitiativeTaskStatus[] = ['todo', 'in-progress', 'done'];

export function taskStatusMeta(status: string): { label: string; color: string } {
  return TASK_STATUS_META[status as InitiativeTaskStatus] ?? TASK_STATUS_META.todo;
}

// Speculative — for the fuller InitiativeTask shape (dedicated Tasks/task
// detail screens, neither built yet), not the confirmed embedded summary.
// The design handoff's "checklist progress overrides manual status" rule has
// no evidence in the real embedded data (no checklist fields on a task at
// all yet), so this no longer tries to derive anything — it's just `status`,
// with `blocked` (itself unconfirmed) as the one override kept from the
// original design intent. Revisit once the real /tasks contract is known.
export function effectiveTaskStatus(task: InitiativeTask, meta?: TaskMeta | null): InitiativeTaskStatus {
  const blocked = meta ? meta.blocked : task.blocked;
  if (blocked) return 'todo';
  return task.status;
}

// None of Initiative's top-level counts survived contact with a real
// response (no member_count/task_count/tasks_done_count field exists) —
// everything here is derived from the embedded tasks/members arrays instead,
// which are confirmed.
export function initiativeMemberCount(initiative: Initiative): number {
  return initiative.members?.length ?? 0;
}

export function initiativeTaskCounts(initiative: Initiative): { total: number; done: number } {
  const tasks = initiative.tasks ?? [];
  return { total: tasks.length, done: tasks.filter((t) => t.status === 'done').length };
}

// The server's own `progress` field reads stale against the real tasks array
// (seen live as 0 while 3 of 5 tasks were already done) — derive from tasks
// instead of trusting it.
export function initiativeProgress(initiative: Initiative): number {
  const { total, done } = initiativeTaskCounts(initiative);
  return total > 0 ? done / total : 0;
}

export function initiativeOpenRoleCount(initiative: Initiative): number {
  return initiative.open_roles_count ?? 0;
}

export function initiativeOrganizerName(initiative: Initiative): string {
  return initiative.createdBy || initiative.created_by;
}

// `updates`' real shape is unconfirmed (the one live response seen had an
// empty array) — read every field defensively and bail to null rather than
// render something that might be wrong. Picks the most recent by whichever
// timestamp field is actually present.
export function initiativeLatestUpdate(initiative: Initiative): { body: string; author: string | null; when: string | null } | null {
  const updates = initiative.updates ?? [];
  if (updates.length === 0) return null;
  const withTime = updates
    .map((u) => ({ u, time: new Date(u.created_at ?? u.createdAt ?? 0).getTime() }))
    .sort((a, b) => b.time - a.time);
  const latest: InitiativeUpdate = withTime[0].u;
  const body = latest.body ?? latest.text;
  if (!body) return null;
  return {
    body,
    author: latest.author_username ?? latest.createdBy ?? null,
    when: latest.created_at ?? latest.createdAt ?? null,
  };
}
