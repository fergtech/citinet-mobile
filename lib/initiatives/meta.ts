import type { ImageSourcePropType } from 'react-native';

import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { Initiative, InitiativeTaskStatus, InitiativeTaskSummary, InitiativeUpdate, TaskMeta } from '@/lib/api/types';

// Category is a lowercase free-form string with no server-side enum — the
// real, authoritative set is citinet web's own CATEGORY_META
// (src/app/components/InitiativeCard.tsx), which every initiative creation
// path (web's create form, the AI create-initiative tool) draws from. This
// used to carry a different, guessed four-value set ("community"/"education"
// instead of "culture"/"safety"/"budget") left over from a design handoff
// that was never actually implemented anywhere — any initiative created on
// web with one of the categories below showed up on mobile as an
// unrecognized "Other" (see initiativeCategoryMeta's fallback), unpickable
// in the create form and absent from the filter tabs. Keep this in sync with
// web's CATEGORY_META if that list ever changes.
export const INITIATIVE_CATEGORIES: Record<string, { label: string; icon: IconSymbolName }> = {
  infrastructure: { label: 'Infrastructure', icon: 'hammer.fill' },
  safety: { label: 'Safety', icon: 'shield.fill' },
  environment: { label: 'Environment', icon: 'leaf.fill' },
  budget: { label: 'Budget', icon: 'building.2.fill' },
  culture: { label: 'Community life', icon: 'person.2.fill' },
};

export const INITIATIVE_CATEGORY_ORDER = ['infrastructure', 'safety', 'environment', 'budget', 'culture'];

export function initiativeCategoryMeta(category: string): { label: string; icon: IconSymbolName } {
  return INITIATIVE_CATEGORIES[category?.toLowerCase()] ?? { label: category || 'Other', icon: 'ellipsis.circle.fill' };
}

// One preset photo per initiative category — the default cover art for any
// initiative that hasn't uploaded its own banner_image_file_name yet,
// replacing the plain solid-color + icon tile everywhere an initiative is
// shown (Home's Initiatives cards, the initiatives list, Discover's row, and
// the detail screen's banner). Metro requires require() targets to be static
// string literals, so this can't be built from INITIATIVE_CATEGORY_ORDER
// dynamically. "culture" reuses the "community" photo supplied for it — same
// concept, just the corrected key (see INITIATIVE_CATEGORIES above).
export const INITIATIVE_CATEGORY_PRESET_IMAGES: Record<string, ImageSourcePropType> = {
  infrastructure: require('@/assets/images/initiatives/infrastructure.jpg'),
  safety: require('@/assets/images/initiatives/safety.jpg'),
  environment: require('@/assets/images/initiatives/environment.jpg'),
  budget: require('@/assets/images/initiatives/budget.jpg'),
  culture: require('@/assets/images/initiatives/community.jpg'),
};

export function initiativeCategoryPresetImage(category: string): ImageSourcePropType | null {
  return INITIATIVE_CATEGORY_PRESET_IMAGES[category?.toLowerCase()] ?? null;
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

// The four-value status shown in the task detail view (app/initiatives/[id]/
// tasks/[taskId].tsx) — a display concept, not a real column. Confirmed
// against citinet web's own InitiativeCard.tsx (TASK_STATUS_META/
// effectiveTaskStatus): `blocked` always wins, then a task with checklist
// items derives todo/in-progress/done purely from checklist completion
// (matching the server's own recomputeTaskStatusFromChecklist), and only a
// checklist-less task falls back to its plain `status` column.
export type TaskDisplayStatus = 'not-started' | 'in-progress' | 'blocked' | 'done';

export const TASK_DISPLAY_STATUS_META: Record<TaskDisplayStatus, { label: string; color: string }> = {
  'not-started': { label: 'Not started', color: '#64748b' },
  'in-progress': { label: 'In progress', color: Brand },
  blocked: { label: 'Blocked', color: '#dc2626' },
  done: { label: 'Done', color: '#059669' },
};

export function effectiveTaskStatus(
  task: InitiativeTaskSummary,
  meta?: TaskMeta | null,
  checklist?: { done: boolean }[] | null
): TaskDisplayStatus {
  if (meta?.blocked) return 'blocked';
  const total = checklist?.length ?? meta?.checklist_total ?? 0;
  if (total === 0) {
    if (task.status === 'done') return 'done';
    if (task.status === 'in-progress') return 'in-progress';
    return 'not-started';
  }
  const done = checklist ? checklist.filter((c) => c.done).length : meta?.checklist_done ?? 0;
  if (done === total) return 'done';
  if (done === 0) return 'not-started';
  return 'in-progress';
}

// A task can only be status-cycled manually (from the tasks list) when the
// viewer created or is assigned to it, AND it has no checklist — a checklist
// present means the server derives status automatically and 409s a manual
// PATCH (see updateTaskStatus's note in hubService.ts).
export function canCycleTaskStatus(task: InitiativeTaskSummary, meta: TaskMeta | undefined, viewerId: string): boolean {
  const ownsTask = task.created_by === viewerId || meta?.assignee_user_id === viewerId;
  const hasChecklist = (meta?.checklist_total ?? 0) > 0;
  return ownsTask && !hasChecklist;
}

export function nextTaskStatus(status: InitiativeTaskStatus): InitiativeTaskStatus {
  if (status === 'todo') return 'in-progress';
  if (status === 'in-progress') return 'done';
  return 'todo';
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
