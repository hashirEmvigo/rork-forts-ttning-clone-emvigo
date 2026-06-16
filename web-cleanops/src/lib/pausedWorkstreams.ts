/**
 * CleanOps Development Center — Paused Workstreams registry (v1).
 *
 * A Super Admin–only, read-only record of larger workstreams that are
 * intentionally PAUSED. It surfaces — directly in the Development Center UI —
 * what is frozen, the latest safe checkpoint, the known blockers, what to do on
 * resume, and what must NOT resume automatically. This mirrors the markdown
 * handoff record (docs/dev-center/10-paused-workstreams-and-handoff-status.md)
 * so the same handoff state is visible in-app, not only buried in the docs.
 *
 * v1 ships as a typed, static seed list shaped like a backend table (stable
 * `key`, ISO `pausedAt`, flat fields) so it can later move to a Supabase
 * `paused_workstreams` table without changing the UI — the page reads from
 * {@link getPausedWorkstreams}, the single seam a future repository would
 * replace.
 *
 * This registry is DOCUMENTATION / STATUS only. It changes no runtime
 * behaviour and authorises no work: every entry carries explicit
 * "do not resume automatically" rules and separate resume instructions.
 */

/** Whether a track is simply paused, or a paused future/not-yet-started project. */
export type WorkstreamState = "paused" | "paused_future";

/**
 * A single paused workstream. Field names map to columns a future Supabase
 * `paused_workstreams` table would carry.
 */
export interface PausedWorkstream {
  id: string;
  /** Stable machine key, e.g. "calculator_v2". Unique across the registry. */
  key: string;
  name: string;
  /** Short owner/area grouping, e.g. "Platform · Identity". */
  area: string;
  state: WorkstreamState;
  /** Human label for the state pill, e.g. "Paused" or "Paused / Future". */
  stateLabel: string;
  /** Whether resuming this track requires a new explicit instruction. */
  requiresExplicitInstruction: boolean;
  /** One-line summary of the latest safe checkpoint. */
  checkpoint: string;
  /** Current status detail. */
  status: string;
  /** Latest completed work, newest-relevant first. */
  latestCompleted: string[];
  /** Known blockers / deferred items. */
  blockers: string[];
  /** Files changed in the latest completed slice, where relevant. */
  filesChanged: string[];
  /** What to do next when resumed. */
  resumeSteps: string[];
  /** What must NOT resume automatically. */
  doNotResume: string[];
  /** ISO timestamp this track was paused / last updated. */
  pausedAt: string;
  /** Optional reference doc path for the full handoff record. */
  referenceDoc?: string;
}

const PAUSED_AT = "2026-06-12T00:00:00.000Z";
const HANDOFF_DOC = "docs/dev-center/10-paused-workstreams-and-handoff-status.md";

/**
 * The seeded paused-workstream registry. Keep this the single source of truth;
 * add or update entries here as tracks are paused or resumed. Nothing in this
 * list authorises resuming work.
 */
const SEED_PAUSED_WORKSTREAMS: ReadonlyArray<Omit<PausedWorkstream, "id">> = [
  {
    key: "typescript_cleanup",
    name: "TypeScript Cleanup / Strict TS Debt",
    area: "Engineering · Code Health",
    state: "paused",
    stateLabel: "Paused",
    requiresExplicitInstruction: true,
    checkpoint: "Strict TS count ~170; last mini-wave reduced strict errors by 5 (test-only).",
    status:
      "Paused. No new cleanup slices, no further strict-mode reduction, no broad TS-DEBT edits, and no \u201CFix errors\u201D usage. Latest known strict TypeScript count is ~170.",
    latestCompleted: [
      "Latest mini-wave reduced strict errors by 5 \u2014 test files only.",
      "Earlier safe slice: Entitlements synthetic limit-key test drift.",
      "Earlier safe slice: scheduleConvergence.test.ts.",
      "Runtime behaviour unchanged across all slices (test fixtures / test-local typing only).",
    ],
    blockers: [
      "Remaining strict TS debt is intentionally deferred: production / data-layer / Supabase cast debt (broad src/lib/data/* casts), Calculator V2-related debt, and other deferred strict-mode issues.",
      "runChecks may still fail on known pre-existing TS-DEBT outside the test-only scope; those known errors must NOT be fixed under this track.",
    ],
    filesChanged: [
      "src/hooks/use-work-order-mutations.test.tsx",
      "src/hooks/use-time-bank-panel.test.tsx",
      "src/components/workorder/ServiceProtocolLink.test.tsx",
    ],
    resumeSteps: [
      "Re-run runChecks (appPath: web-cleanops).",
      "Re-run the strict TypeScript baseline and report the current total errors.",
      "Propose one safe slice at a time; prefer test-only fixture drift.",
      "Avoid broad src/lib/data/* cast debt unless explicitly approved.",
      "Avoid Calculator V2 and Auth/Admin lifecycle unless explicitly approved.",
    ],
    doNotResume: [
      "Do not start new cleanup slices automatically.",
      "Do not touch broad src/lib/data/* / Supabase cast debt.",
      "Do not use \u201CFix errors\u201D.",
      "Do not pull Calculator V2 or Auth/Admin-lifecycle debt into this track.",
    ],
    pausedAt: PAUSED_AT,
    referenceDoc: HANDOFF_DOC,
  },
  {
    key: "calculator_v2",
    name: "Calculator V2",
    area: "Public · Price Calculator",
    state: "paused_future",
    stateLabel: "Paused / Future",
    requiresExplicitInstruction: true,
    checkpoint: "Future project; not started. Do not infer from background context.",
    status:
      "Paused completely; remains a future project. Not started. An approved strategy plan exists on file, but no V2 implementation slice has been executed.",
    latestCompleted: [
      "None for V2 implementation.",
      "Adjacent completed baseline (separate from V2 rebuild): the Home-only calculator baseline \u2014 see docs/dev-center/price-calculator/04-home-only-baseline-status.md.",
    ],
    blockers: [
      "Must wait for a new explicit instruction.",
      "Must NOT be picked up because it appears in background context, plan reminders, or chat history.",
    ],
    filesChanged: [],
    resumeSteps: [
      "Start from a fresh Calculator V2 plan confirmation.",
      "Do not infer from background context.",
      "Do not update plan checkboxes unless actually implementing a confirmed slice.",
      "Keep Calculator V2 separate from general TS cleanup.",
    ],
    doNotResume: [
      "Do not work on Calculator V2.",
      "Do not update Calculator V2 plan checkboxes.",
      "Do not modify calculator runtime behaviour.",
      "Do not modify calculator tests.",
      "Do not infer Calculator V2 work from background context or plan reminders.",
    ],
    pausedAt: PAUSED_AT,
    referenceDoc: HANDOFF_DOC,
  },
  {
    key: "auth_admin_user_lifecycle",
    name: "Auth / Invite / Admin User Lifecycle",
    area: "Platform · Identity",
    state: "paused",
    stateLabel: "Paused",
    requiresExplicitInstruction: true,
    checkpoint:
      "Password recovery works; admin-user-lifecycle deploy paused on a local repo/sync issue.",
    status: "Paused, including deployment/debugging for admin-user-lifecycle.",
    latestCompleted: [
      "Password recovery works; its UX / error handling was improved.",
      "Admin User Lifecycle UI / function work exists in the repo (supabase/functions/admin-user-lifecycle/index.ts and supporting UI).",
    ],
    blockers: [
      "admin-user-lifecycle deployment is paused.",
      "A local repo/sync issue blocked the local deploy: the operator's local folder did not contain supabase/functions/admin-user-lifecycle/index.ts. In the Rork-synced repo the file IS present \u2014 resolve the local sync first.",
      "Not blocking current work.",
    ],
    filesChanged: [],
    resumeSteps: [
      "First resolve the repo/sync issue; confirm supabase/functions/admin-user-lifecycle/index.ts exists locally.",
      "Deploy: supabase functions deploy admin-user-lifecycle --project-ref swqcdcpwofdnmoureifu.",
      "Test: Last Login / Invite Status, Resend Invite, Disable User, blocked login after disable, Enable User, successful login after enable.",
    ],
    doNotResume: [
      "Do not continue deployment/debugging for admin-user-lifecycle.",
      "Do not touch the invite flow.",
      "Do not touch password recovery.",
      "Do not touch user lifecycle actions.",
      "Do not touch Edge Functions.",
    ],
    pausedAt: PAUSED_AT,
    referenceDoc: HANDOFF_DOC,
  },
];

let cached: PausedWorkstream[] | null = null;

/**
 * Returns the paused-workstream registry in declared order. This is the single
 * seam a future Supabase repository would replace — the UI must not read the
 * seed array directly. Ids are derived deterministically from each entry's
 * position so they remain stable across reloads. Pure and read-only.
 */
export function getPausedWorkstreams(): PausedWorkstream[] {
  if (cached) return cached;
  cached = SEED_PAUSED_WORKSTREAMS.map((w, i) => ({ id: `pw-${i + 1}`, ...w }));
  return cached;
}
