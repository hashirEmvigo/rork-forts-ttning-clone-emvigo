/**
 * Feature flags for the gradual localStorage → Supabase migration.
 *
 * Flags default to `false` so the app keeps behaving exactly as today
 * (localStorage is the single source of truth). A flag can be flipped on in a
 * staging build via an `EXPO_PUBLIC_*` env var without code changes.
 */

/** Reads a public boolean env var, treating only the string "true" as on. */
function envFlag(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Resolves a source-of-truth CUT-OVER flag that is now authoritative-ON by
 * default in real app builds, with instant, data-free rollback via an explicit
 * `=false` env override:
 *
 *   • value === "true"  → ON  (explicit opt-in / staging override)
 *   • value === "false" → OFF (explicit rollback to localStorage authority)
 *   • unset             → ON in app builds, OFF under vitest
 *
 * Under vitest (`MODE === "test"`) the default stays OFF so the cut-over
 * safe-default suites keep validating the localStorage-authoritative path; the
 * ON path is covered by the dual-write / soak suites that opt in explicitly via
 * an env stub. Production rollback remains a single env flip.
 */
function cutoverFlag(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return import.meta.env.MODE !== "test";
}

/**
 * USE_SUPABASE_COMPANIES
 *
 * When `false` (default): companies come from localStorage as today.
 * When `true`: the app fetches companies from Supabase in READ-ONLY mode,
 *   falling back to localStorage if Supabase is unavailable or returns nothing.
 *   No company changes are written to Supabase yet.
 *
 * Override at build time with EXPO_PUBLIC_USE_SUPABASE_COMPANIES=true.
 */
export const USE_SUPABASE_COMPANIES: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_USE_SUPABASE_COMPANIES) || false;

/**
 * USE_SUPABASE_AUTH
 *
 * When `false` (default): authentication is handled entirely by localStorage,
 *   exactly as today. The Supabase Auth client layer stays completely dormant —
 *   it is never invoked, no session is read, no profile is loaded.
 * When `true`: later migration steps (2B.4+) may route sign-in through Supabase
 *   Auth for selected users. This flag only *enables* that path to exist; it
 *   does NOT change the current login UI on its own.
 *
 * Override at build time with EXPO_PUBLIC_USE_SUPABASE_AUTH=true.
 */
export const USE_SUPABASE_AUTH: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_USE_SUPABASE_AUTH) || false;

/**
 * ENABLE_USER_CREATION
 *
 * When `false` (default): the admin-only "Create user" screen does not exist —
 *   its route is not registered and no nav entry is shown. The localStorage
 *   login and all current flows are completely unaffected.
 * When `true`: a Super Admin–only screen becomes available that creates real
 *   Supabase Auth users through the `admin-create-user` Edge Function (invite
 *   email flow). The service_role key never touches the browser; it lives only
 *   inside the Edge Function / Supabase secrets.
 *
 * Override at build time with EXPO_PUBLIC_ENABLE_USER_CREATION=true.
 */
export const ENABLE_USER_CREATION: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ENABLE_USER_CREATION) || false;

/**
 * CUSTOMERS_LIST_SUPABASE_READ (P4F · Wave 1B)
 *
 * When `false` (default): the Customers list reads from localStorage exactly as
 *   today — the single source of truth, unchanged.
 * When `true`: the Customers list READS the customer records from Supabase
 *   (full rows reconstructed from the `data` jsonb), behind the validated
 *   {@link CustomerRepository} seam. Search, pagination, sorting, company scope
 *   and row rendering are all preserved. If Supabase is unreachable or returns
 *   nothing, the list transparently falls back to localStorage.
 *
 * Scope is intentionally narrow — ONLY list reads move. The Customer Card and
 * every customer write (create / update / archive) stay on localStorage. A
 * background shadow read keeps comparing both sources and surfaces any drift.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_CUSTOMERS_LIST_SUPABASE_READ=true.
 */
export const CUSTOMERS_LIST_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CUSTOMERS_LIST_SUPABASE_READ) || false;

/**
 * CUSTOMERS_DETAIL_SUPABASE_READ (P4G · Wave 1C)
 *
 * When `false` (default): the Customer Card resolves its customer from
 *   localStorage exactly as today — the single source of truth, unchanged.
 * When `true`: the Customer Card READS the customer detail from Supabase via
 *   {@link CustomerRepository.getDetail} (the lossless `data` jsonb), behind the
 *   validated repository seam. Every visible field, tab and layout is preserved.
 *   If Supabase is unreachable, errors, or has no row for this customer, the
 *   card transparently falls back to the localStorage record — it never breaks.
 *
 * Scope is intentionally narrow — ONLY the Customer Card DETAIL read moves. The
 * Customers list flag is independent, and every customer write (create / update
 * / archive) stays on localStorage. A background shadow read keeps comparing
 * both detail sources and surfaces any drift.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_CUSTOMERS_DETAIL_SUPABASE_READ=true.
 */
export const CUSTOMERS_DETAIL_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CUSTOMERS_DETAIL_SUPABASE_READ) || false;

/**
 * CUSTOMERS_DUAL_WRITE (P4H · Wave 1D)
 *
 * The FIRST write-path migration step. localStorage stays the single source of
 * truth for every customer write; this flag only enables MIRRORING those writes
 * into Supabase so we can prove write parity before any cut-over.
 *
 * When `false` (default): customer create / update / archive write to
 *   localStorage only, exactly as today — Supabase is never touched on write.
 * When `true`: every customer write still completes synchronously against
 *   localStorage first (authoritative, never blocked), and is THEN mirrored to
 *   Supabase in the background via {@link mirrorCustomerWrites}. The mirror is
 *   fire-and-forget: a Supabase failure / timeout is recorded as drift but the
 *   customer operation always succeeds. A validation pass compares the two
 *   sides field-by-field and surfaces any mismatch — never silently ignored.
 *
 * Scope is intentionally narrow — ONLY writes mirror. Reads are governed by the
 * independent list / detail flags. localStorage remains authoritative; Supabase
 * is the shadow target.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_CUSTOMERS_DUAL_WRITE=true.
 */
export const CUSTOMERS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CUSTOMERS_DUAL_WRITE) || false;

/**
 * CUSTOMERS_SUPABASE_AUTHORITATIVE (P4J · Wave 1F)
 *
 * The FIRST true operational source-of-truth cut-over. Until now localStorage
 * has stayed authoritative for Customers and Supabase has been a validated
 * shadow (reads behind list/detail flags, writes mirrored by dual-write). This
 * flag flips the authority — Supabase becomes primary — while keeping
 * localStorage as a synchronized BACKOUT copy so rollback stays instant and
 * data-free.
 *
 * When `false` (default): nothing changes. Reads obey the independent list /
 *   detail flags; writes obey the dual-write flag; localStorage is authoritative.
 * When `true`:
 *   • READS — the Customers list and Customer Card read from Supabase as the
 *     PRIMARY source (this flag implies the read paths even if their own flags
 *     are off). On a Supabase failure the UI falls back to the localStorage
 *     backout copy, but the failure is RECORDED + surfaced — never silent.
 *   • WRITES — every write still completes synchronously against localStorage
 *     first (the backout copy, option B — safest, instantly reversible) and is
 *     then mirrored to Supabase, which is now the authoritative store. Mirror
 *     failures are recorded as authoritative-write failures (never block the op).
 *
 * DEFAULT (P-cutover · B-area 1): this flag is now authoritative-ON in real app
 * builds — Supabase is the primary Customer source and localStorage is the
 * synchronized backout copy. It stays OFF under vitest so the safe-default
 * cut-over suites keep validating the localStorage path.
 *
 * Rollback is documented + executable: set EXPO_PUBLIC_CUSTOMERS_SUPABASE_AUTHORITATIVE=false
 * → localStorage authoritative again. Any Supabase-only writes accrued after
 * cut-over are recovered via the shadow read + the Wave 1A migration tool before
 * flipping back.
 *
 * Override at build time with EXPO_PUBLIC_CUSTOMERS_SUPABASE_AUTHORITATIVE=true|false.
 */
export const CUSTOMERS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_CUSTOMERS_SUPABASE_AUTHORITATIVE);

/**
 * WORK_ORDERS_LIST_SUPABASE_READ (P5D · WO-2)
 *
 * The FIRST Work Order read-path switch — the direct analogue of
 * {@link CUSTOMERS_LIST_SUPABASE_READ}, applied to the Work Order LIST surface
 * (the Customer Card · Work Orders tab, the only multi-row work-order list in
 * the app today).
 *
 * When `false` (default): the Work Order list reads from localStorage exactly as
 *   today — the in-memory AppContext `workOrders` array, the single source of
 *   truth, unchanged.
 * When `true`: the Work Order list READS the full work-order records from
 *   Supabase (losslessly reconstructed from the `data` jsonb) via the validated
 *   {@link WorkOrderRepository} seam. Customer scope, status filtering, sorting
 *   and row rendering are all preserved. If Supabase is unreachable, errors, or
 *   returns nothing, the list transparently falls back to localStorage so it
 *   never goes blank.
 *
 * Scope is intentionally narrow — ONLY list reads move. WorkOrderDetails, the
 * Schedule resolver and every work-order write (create / update / archive /
 * service-row / variation / staffing) all stay on localStorage. A background
 * shadow read keeps comparing both sources and surfaces any drift.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * ROLLOUT DEFAULT (Work Orders Phase 2A): this flag is now ON by default in real
 * app builds via {@link cutoverFlag} so the intended list-read state is TRACKED
 * in source and can no longer be silently disabled by a reset/untracked `.env`.
 * It stays OFF under vitest so the safe-default suites keep validating the
 * localStorage path. An explicit env value still overrides either way.
 *
 * Override at build time with EXPO_PUBLIC_WORK_ORDERS_LIST_SUPABASE_READ=true|false.
 */
export const WORK_ORDERS_LIST_SUPABASE_READ: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_WORK_ORDERS_LIST_SUPABASE_READ);

/**
 * WORK_ORDERS_DETAIL_SUPABASE_READ (P5E · WO-3)
 *
 * The SECOND Work Order read-path switch — the direct analogue of
 * {@link CUSTOMERS_DETAIL_SUPABASE_READ}, applied to the WorkOrderDetails page.
 *
 * When `false` (default): WorkOrderDetails resolves its work order from
 *   localStorage exactly as today — the in-memory AppContext `workOrders`
 *   array via `getWorkOrder`, the single source of truth, unchanged.
 * When `true`: WorkOrderDetails READS the full work-order detail from Supabase
 *   via {@link WorkOrderRepository.getDetail} (the lossless `data` jsonb),
 *   behind the validated repository seam. Every visible field, tab and the
 *   nested `serviceRows` are preserved. If Supabase is unreachable, errors, or
 *   has no row for this id, the page transparently falls back to the
 *   localStorage record — it never breaks. The localStorage `getWorkOrder`
 *   still gates ACCESS (company / area scope) before any Supabase read runs.
 *
 * Scope is intentionally narrow — ONLY the WorkOrderDetails DETAIL read moves.
 * The list flag is independent, and every work-order write (create / update /
 * archive / service-row / variation / staffing) plus the Schedule resolver stay
 * on localStorage. A background detail shadow read keeps comparing both sources
 * field-by-field and surfaces any drift (never silently ignored).
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_WORK_ORDERS_DETAIL_SUPABASE_READ=true.
 */
export const WORK_ORDERS_DETAIL_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_WORK_ORDERS_DETAIL_SUPABASE_READ) || false;

/**
 * WORK_ORDERS_DUAL_WRITE (P5G · WO-5)
 *
 * The FIRST Work Order WRITE-path migration step — the direct analogue of
 * {@link CUSTOMERS_DUAL_WRITE}, applied to the work-order write seam
 * (`AppContext.persistWorkOrders`) plus the separate occurrence-exception seam
 * (`AppContext.persistBookingOccurrenceExceptions`). localStorage stays the
 * single source of truth for every work-order write; this flag only enables
 * MIRRORING those writes into Supabase so we can prove write parity before any
 * cut-over (WO-6).
 *
 * When `false` (default): work-order create / update / archive / service-row /
 *   variation / staffing writes and exception writes go to localStorage only,
 *   exactly as today — Supabase is never touched on write.
 * When `true`: every work-order write still completes synchronously against
 *   localStorage first (authoritative, never blocked), and is THEN mirrored to
 *   Supabase in the background via {@link mirrorWorkOrderWrites} (parent +
 *   `work_order_service_rows`) and {@link mirrorWorkOrderExceptionWrites}
 *   (`work_order_occurrence_exceptions`). The mirror is fire-and-forget: a
 *   Supabase failure / timeout is recorded as drift but the work-order
 *   operation always succeeds. A validation pass compares the two sides
 *   field-by-field and surfaces any mismatch — never silently ignored.
 *
 * Scope is intentionally narrow — ONLY writes mirror. Reads are governed by the
 * independent list / detail flags; the Schedule resolver, recurrence, variation
 * and exception LOGIC are all untouched. localStorage remains authoritative;
 * Supabase is the shadow target.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * ROLLOUT DEFAULT (Work Orders Phase 1/2A): this flag is now ON by default in
 * real app builds via {@link cutoverFlag} so the intended dual-write mirror state
 * is TRACKED in source and can no longer be silently disabled by a reset/
 * untracked `.env`. It stays OFF under vitest so the safe-default suites keep
 * validating the localStorage path. An explicit env value still overrides.
 *
 * Override at build time with EXPO_PUBLIC_WORK_ORDERS_DUAL_WRITE=true|false.
 */
export const WORK_ORDERS_DUAL_WRITE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_WORK_ORDERS_DUAL_WRITE);

/**
 * WORK_ORDERS_SUPABASE_AUTHORITATIVE (P5J · WO-6)
 *
 * The Work Orders source-of-truth cut-over — the direct analogue of
 * {@link CUSTOMERS_SUPABASE_AUTHORITATIVE}. Until now localStorage has stayed
 * authoritative for Work Orders and Supabase has been a validated shadow (reads
 * behind the list/detail flags, writes mirrored by dual-write incl. WO-5.6
 * removal propagation). This flag flips the authority — Supabase becomes primary
 * — while keeping localStorage as a synchronized BACKOUT copy so rollback stays
 * instant and data-free.
 *
 * IMPORTANT: this is Work Orders ONLY. The Schedule resolver
 * ({@link resolveScheduleProgram}), recurrence, variation and exception LOGIC are
 * all untouched; Schedule continues to read the local resolver path. Schedule
 * interval-query migration is a later phase (WO-7).
 *
 * When `false` (default): nothing changes. Reads obey the independent list /
 *   detail flags; writes obey the dual-write flag; localStorage is authoritative.
 * When `true`:
 *   • READS — the Work Order list (Customer Card · Work Orders tab) and
 *     WorkOrderDetails read from Supabase as the PRIMARY source (this flag
 *     implies the read paths even if their own flags are off). On a Supabase
 *     failure the UI falls back to the localStorage backout copy, but the
 *     failure is RECORDED + surfaced — never silent.
 *   • WRITES — every work-order write still completes synchronously against
 *     localStorage first (the backout copy, strategy B — safest, instantly
 *     reversible) and is then mirrored to Supabase, which is now the
 *     authoritative store (parent + service rows + the SEPARATE occurrence
 *     exceptions, incl. WO-5.6 soft-delete removal propagation). Mirror failures
 *     are recorded as authoritative-write failures (never block the op).
 *
 * DEFAULT (Work Orders Phase 2A — authoritative deliberately held OFF): while the
 * Work Orders rollout is mid-flight (dual-write + list read only), this flag is
 * pinned OFF by default via {@link envFlag} rather than {@link cutoverFlag}. The
 * previous cutoverFlag default-ON was dangerous for this UNFINISHED module: a
 * reset/untracked `.env` would silently flip Work Orders into Supabase-
 * authoritative reads+writes. Defaulting OFF guarantees authority cannot turn ON
 * when the env var is unset. Enabling true authoritative cut-over later is an
 * explicit, deliberate env opt-in (=true).
 *
 * Rollback is documented + executable: it is OFF by default; an explicit
 * EXPO_PUBLIC_WORK_ORDERS_SUPABASE_AUTHORITATIVE=true opts in, =false pins off.
 * Any Supabase-only writes accrued after a future cut-over are recovered via the
 * shadow read + the WO-1 migration tool before flipping back.
 *
 * Override at build time with EXPO_PUBLIC_WORK_ORDERS_SUPABASE_AUTHORITATIVE=true|false.
 */
export const WORK_ORDERS_SUPABASE_AUTHORITATIVE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_WORK_ORDERS_SUPABASE_AUTHORITATIVE) || false;

/**
 * SCHEDULE_SUPABASE_INTERVAL_READ (P6B · Schedule interval read switch)
 *
 * The FIRST Schedule read-path switch. It moves ONLY the SOURCE of the
 * Schedule's resolver INPUT (the work orders + the base occurrence exceptions)
 * behind a flag — the resolver {@link resolveScheduleProgram}, recurrence,
 * variation and exception LOGIC, the board, metrics, filters, cache and every
 * interaction are all untouched.
 *
 * When `false` (default): the Schedule builds its `ScheduleCoreInput` from the
 *   in-memory AppContext `workOrders` + `bookingOccurrenceExceptions` exactly as
 *   today — the single source of truth, unchanged.
 * When `true`: the Schedule builds the SAME input shape from the Supabase-backed
 *   work orders (losslessly reconstructed from the `data` jsonb) + the Supabase
 *   occurrence exceptions, via the validated WO-4 builder
 *   {@link buildScheduleInputFromSupabase}. The customer / employee / postal-city
 *   LOOKUPS are still held constant from the local store (those entities migrate
 *   on their own tracks). The legacy-reschedule bridge is applied identically on
 *   top of whichever exception source is active, so board behaviour is preserved.
 *   If Supabase is unreachable / errors / returns nothing, the Schedule
 *   transparently falls back to the localStorage input — it never breaks.
 *
 * Scope is intentionally narrow — ONLY the resolver INPUT source moves. A
 * background {@link compareScheduleInterval} keeps diffing the local-input and
 * Supabase-input resolves occurrence-by-occurrence and surfaces any drift (never
 * silently ignored). The interval cache key carries the active source so local
 * and Supabase interval results can never collide.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_SCHEDULE_SUPABASE_INTERVAL_READ=true.
 */
export const SCHEDULE_SUPABASE_INTERVAL_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SCHEDULE_SUPABASE_INTERVAL_READ) || false;

/**
 * SCHEDULE_SUPABASE_AUTHORITATIVE (P6D · Schedule authoritative input cutover)
 *
 * The Schedule source-of-truth cut-over for the resolver INPUT — the Schedule
 * analogue of {@link WORK_ORDERS_SUPABASE_AUTHORITATIVE}, but deliberately
 * narrower: it makes Supabase authoritative ONLY for the data the Schedule feeds
 * into the resolver, NOT for any new schedule engine. P6C confirmed that
 * server-generated occurrence summaries are too risky; this phase keeps the
 * existing engine and only flips which input store is authoritative.
 *
 * IMPORTANT: {@link resolveScheduleProgram}, recurrence, variation and exception
 * LOGIC, the board, metrics, filters and every interaction are all untouched.
 * There is exactly ONE resolver and no realtime.
 *
 * When `false` (default): the Schedule input obeys the independent
 *   {@link SCHEDULE_SUPABASE_INTERVAL_READ} flag; localStorage is the
 *   authoritative input.
 * When `true`: the existing P6C interval-scoped Supabase input becomes the
 *   AUTHORITATIVE resolver input (this flag IMPLIES the interval read path even
 *   if its own flag is off). localStorage stays a synchronized fallback / backout
 *   input: if Supabase is unreachable / errors / returns nothing, the Schedule
 *   transparently falls back to the local input and the fallback is RECORDED +
 *   surfaced — never silent. The background {@link compareScheduleEntries} shadow
 *   diff stays active and the interval cache key carries the authority mode so an
 *   authoritative interval can never collide with a non-authoritative one.
 *
 * DEFAULT (P-cutover · B-area 2): this flag is now authoritative-ON in real app
 * builds — the Supabase-backed interval input is the authoritative resolver
 * input and localStorage is the synchronized fallback / backout input. It stays
 * OFF under vitest so the safe-default cut-over suites keep validating the
 * localStorage input path.
 *
 * Rollback is instant and data-free: set EXPO_PUBLIC_SCHEDULE_SUPABASE_AUTHORITATIVE=false
 * → localStorage is the authoritative input again.
 *
 * Override at build time with EXPO_PUBLIC_SCHEDULE_SUPABASE_AUTHORITATIVE=true|false.
 */
export const SCHEDULE_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_SCHEDULE_SUPABASE_AUTHORITATIVE);

/**
 * EMPLOYEES_SUPABASE_READ (P7D · EMP-2 · Employees read-path introduction)
 *
 * The FIRST Employees read-path switch — the Employees analogue of
 * {@link SCHEDULE_SUPABASE_INTERVAL_READ}, but adapted to the fact that Employees
 * is a single global company directory (an in-memory array seeded once at app
 * mount), NOT an interval-scoped projection. It moves ONLY the SOURCE of the
 * employee directory behind a flag — assignment logic, the Schedule resolver,
 * Teams, the linked-login User write path and every employee WRITE are untouched.
 *
 * When `false` (default): the employee directory is seeded from localStorage
 *   exactly as today — the single source of truth, fully synchronous, unchanged.
 * When `true`: the directory READS the full employee records (losslessly
 *   reconstructed from the `data` jsonb) from Supabase via the validated
 *   {@link listFullEmployeesFromSupabase} path, behind the EMP-2 read seam
 *   ({@link useEmployeeDirectorySource}). The synchronous localStorage seed is
 *   kept first (zero flash), then reconciled from Supabase only on a HEALTHY,
 *   NON-EMPTY result. If Supabase is unreachable, errors, or returns nothing
 *   while localStorage has data, the directory transparently keeps the local
 *   seed — it never blanks. A background {@link shadowReadEmployees} keeps
 *   comparing both sources and surfaces any drift (never silently ignored).
 *
 * Scope is intentionally narrow — ONLY directory reads move. localStorage stays
 * authoritative and the ONLY write target; there is NO dual-write and NO
 * authoritative mode in EMP-2 (a separate flag would introduce those later).
 *
 * Empty-result safety (Framework v0.2 §8): an empty Supabase result while
 * localStorage has data is treated as UNSAFE — the local seed is retained and
 * the event is recorded; empty equals a successful read ONLY when local is also
 * empty.
 *
 * DEFAULT (P-cutover · B-area 3): this flag now uses the shared
 * {@link cutoverFlag} resolver — authoritative-ON in real app builds so the
 * employee directory reconciles from Supabase as the primary source, OFF only
 * under vitest so the safe-default read suites keep validating the localStorage
 * seed path. localStorage stays the synchronized backout seed: on a Supabase
 * error / unsafe-empty / unreachable result the directory transparently keeps
 * the local seed (it never blanks) and the fallback is recorded + surfaced.
 *
 * Rollback is instant and data-free: set EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ=false
 * → the next mount seeds from localStorage only, with no Supabase dependency on
 * the path.
 *
 * Override at build time with EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ=true|false.
 */
export const EMPLOYEES_SUPABASE_READ: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ);

/**
 * EMPLOYEES_DUAL_WRITE (EMP-4 · Employees write-path mirror)
 *
 * The granular Employees write-path switch — the Employees analogue of
 * {@link CUSTOMERS_DUAL_WRITE} / {@link TEAMS_DUAL_WRITE}. localStorage stays the
 * single source of truth for every employee write; this flag only enables
 * MIRRORING those writes into the Supabase `employees` table (incl. soft-delete
 * removal propagation, mirroring the WO-5.6 / Teams convention) so we can prove
 * write parity BEFORE any write cut-over.
 *
 * NAMING: the area prefix is intentionally the plural EMPLOYEES_ to match the
 * existing {@link EMPLOYEES_SUPABASE_READ} flag and the codebase convention
 * (CUSTOMERS_/TEAMS_/WORK_ORDERS_). The build-time env var is therefore
 * EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE.
 *
 * When `false` (default): employee create / update / archive / delete write to
 *   localStorage only — Supabase is never touched on write.
 * When `true`: every employee write still completes synchronously against
 *   localStorage first (authoritative, never blocked), and is THEN mirrored to
 *   Supabase in the background via `mirrorEmployeeWrites`. The mirror is
 *   fire-and-forget and self-validating; a removed employee soft-deletes the
 *   Supabase row (`deleted_at` set). A Supabase failure is recorded as drift but
 *   the employee operation always succeeds.
 *
 * CRITICAL context: the Employees READ path ({@link EMPLOYEES_SUPABASE_READ}) is
 * already authoritative-ON in real app builds, but employee WRITES still only hit
 * localStorage. This flag closes that asymmetry so reads stop reconciling to a
 * stale/partial Supabase dataset. It introduces NO authoritative-write mode — a
 * separate flag would do that later.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE=true.
 */
export const EMPLOYEES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE) || false;

/**
 * EMPLOYEES_SHADOW_VALIDATE (EMP-4 · Employees write-mirror shadow validation)
 *
 * An optional, deeper parity check layered on top of {@link EMPLOYEES_DUAL_WRITE}.
 * The mirror ALWAYS performs a cheap post-write field validation (re-reads the
 * just-written rows and compares the critical fields). When this flag is on, the
 * mirror ADDITIONALLY runs a company-scoped `shadowReadEmployees` parity pass
 * after a successful mirror to surface broader divergence (count / id set /
 * summary / detail) between the localStorage directory and the Supabase copy.
 * Drift is recorded via the EMP-2 cutover telemetry and never blocks the write.
 *
 * Has no effect unless {@link EMPLOYEES_DUAL_WRITE} (or a future authoritative
 * write flag) is also on. Logs are dev-only / behind this flag, never noisy in
 * production. The build-time env var is EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE.
 *
 * When `false` (default): only the always-on post-write field validation runs.
 * When `true`: the deeper company-scoped shadow comparison runs after each
 *   successful mirror and records drift for observability.
 *
 * Rollback is instant and data-free: set this back to OFF.
 *
 * Override at build time with EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE=true.
 */
export const EMPLOYEES_SHADOW_VALIDATE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE) || false;

/**
 * TEAMS_SUPABASE_READ (TEAM-2 · Teams read-path introduction)
 *
 * The granular Teams read-path switch — the Teams analogue of
 * {@link EMPLOYEES_SUPABASE_READ}. Teams is a single global company directory (an
 * in-memory array seeded once at app mount), so this moves ONLY the SOURCE of the
 * team directory behind a flag. Employee team-membership, assignment logic and
 * every team WRITE are untouched.
 *
 * When `false` (default): the team directory is seeded from localStorage exactly
 *   as today — the single source of truth, fully synchronous, unchanged.
 * When `true`: the directory READS the full team records (losslessly
 *   reconstructed from the `data` jsonb) from Supabase via the validated
 *   {@link listFullTeamsFromSupabase} path, behind the TEAM-2 read seam
 *   ({@link useTeamDirectorySource}). The synchronous localStorage seed is kept
 *   first (zero flash), then reconciled from Supabase only on a HEALTHY,
 *   NON-EMPTY result. An empty Supabase result while localStorage has data is
 *   UNSAFE (Framework v0.2 §8) — the local seed is retained, never blanked.
 *
 * This granular flag stays OFF by default; the authoritative cut-over is driven
 * by {@link TEAMS_SUPABASE_AUTHORITATIVE}, which IMPLIES this read path.
 *
 * Override at build time with EXPO_PUBLIC_TEAMS_SUPABASE_READ=true.
 */
export const TEAMS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TEAMS_SUPABASE_READ) || false;

/**
 * TEAMS_DUAL_WRITE (TEAM-3 · Teams write-path mirror)
 *
 * The granular Teams write-path switch — the Teams analogue of
 * {@link CUSTOMERS_DUAL_WRITE}. localStorage stays the single source of truth for
 * every team write; this flag only enables MIRRORING those writes into Supabase
 * (incl. soft-delete removal propagation) so we can prove write parity.
 *
 * When `false` (default): team create / update / delete write to localStorage
 *   only — Supabase is never touched on write.
 * When `true`: every team write still completes synchronously against
 *   localStorage first (authoritative, never blocked), and is THEN mirrored to
 *   Supabase in the background via {@link mirrorTeamWrites}. The mirror is
 *   fire-and-forget and self-validating; removals soft-delete the Supabase row.
 *
 * This granular flag stays OFF by default; the authoritative cut-over is driven
 * by {@link TEAMS_SUPABASE_AUTHORITATIVE}, which IMPLIES this mirror.
 *
 * Override at build time with EXPO_PUBLIC_TEAMS_DUAL_WRITE=true.
 */
export const TEAMS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TEAMS_DUAL_WRITE) || false;

/**
 * TEAMS_SUPABASE_AUTHORITATIVE (TEAM-4 · Teams source-of-truth cut-over)
 *
 * The Teams source-of-truth cut-over — the direct analogue of
 * {@link CUSTOMERS_SUPABASE_AUTHORITATIVE} / {@link WORK_ORDERS_SUPABASE_AUTHORITATIVE},
 * adapted to the global-directory shape (like Employees). It flips the authority —
 * Supabase becomes primary — while keeping localStorage as a synchronized BACKOUT
 * copy so rollback stays instant and data-free.
 *
 * When `false`: reads obey {@link TEAMS_SUPABASE_READ}; writes obey
 *   {@link TEAMS_DUAL_WRITE}; localStorage is authoritative.
 * When `true`:
 *   • READS — the team directory reads from Supabase as the PRIMARY source (this
 *     flag IMPLIES the read path even if {@link TEAMS_SUPABASE_READ} is off). On a
 *     Supabase failure / unsafe-empty the UI keeps the localStorage backout seed,
 *     but the fallback is RECORDED + surfaced — never silent.
 *   • WRITES — every write still completes synchronously against localStorage
 *     first (the backout copy, strategy B — safest, instantly reversible) and is
 *     then mirrored to Supabase, which is now the authoritative store (incl.
 *     soft-delete removal propagation). Mirror failures are recorded (never block).
 *
 * DEFAULT (P-cutover · B-area 4): this flag uses the shared {@link cutoverFlag}
 * resolver — authoritative-ON in real app builds so Teams are Supabase-primary and
 * consistent across devices, OFF only under vitest so the safe-default suites keep
 * validating the localStorage path. Rollback is instant + data-free:
 * EXPO_PUBLIC_TEAMS_SUPABASE_AUTHORITATIVE=false.
 *
 * Override at build time with EXPO_PUBLIC_TEAMS_SUPABASE_AUTHORITATIVE=true|false.
 */
export const TEAMS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_TEAMS_SUPABASE_AUTHORITATIVE);

/**
 * SERVICES_SUPABASE_READ (SVC-2 · Services read-path introduction)
 *
 * The granular Services read-path switch — the Services analogue of
 * {@link TEAMS_SUPABASE_READ}. Services is a single global company directory (an
 * in-memory array seeded once at app mount that holds BOTH the Super Admin global
 * catalog and company services), so this moves ONLY the SOURCE of the service
 * directory behind a flag. Categories, packages, payroll-group references and
 * every service WRITE are untouched.
 *
 * When `false` (default): the service directory is seeded from localStorage
 *   exactly as today — the single source of truth, fully synchronous, unchanged.
 * When `true`: the directory READS the full service records (losslessly
 *   reconstructed from the `data` jsonb) from Supabase via the validated
 *   {@link listFullServicesFromSupabase} path (the company's services PLUS the
 *   shared global catalog), behind the SVC-2 read seam
 *   ({@link useServiceDirectorySource}). The synchronous localStorage seed is
 *   kept first (zero flash), then reconciled from Supabase only on a HEALTHY,
 *   NON-EMPTY result. An empty Supabase result while localStorage has data is
 *   UNSAFE (Framework v0.2 §8) — the local seed is retained, never blanked.
 *
 * This granular flag stays OFF by default; the authoritative cut-over is driven
 * by {@link SERVICES_SUPABASE_AUTHORITATIVE}, which IMPLIES this read path.
 *
 * Override at build time with EXPO_PUBLIC_SERVICES_SUPABASE_READ=true.
 */
export const SERVICES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SERVICES_SUPABASE_READ) || false;

/**
 * SERVICES_DUAL_WRITE (SVC-3 · Services write-path mirror)
 *
 * The granular Services write-path switch — the Services analogue of
 * {@link TEAMS_DUAL_WRITE}. localStorage stays the single source of truth for
 * every service write; this flag only enables MIRRORING those writes into
 * Supabase (incl. soft-delete removal propagation) so we can prove write parity.
 *
 * When `false` (default): service create / update / delete write to localStorage
 *   only — Supabase is never touched on write.
 * When `true`: every service write still completes synchronously against
 *   localStorage first (authoritative, never blocked), and is THEN mirrored to
 *   Supabase in the background via {@link mirrorServiceWrites}. The mirror is
 *   fire-and-forget and self-validating; removals soft-delete the Supabase row.
 *   Global services (companyId === null) mirror with company_id = null.
 *
 * This granular flag stays OFF by default; the authoritative cut-over is driven
 * by {@link SERVICES_SUPABASE_AUTHORITATIVE}, which IMPLIES this mirror.
 *
 * Override at build time with EXPO_PUBLIC_SERVICES_DUAL_WRITE=true.
 */
export const SERVICES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SERVICES_DUAL_WRITE) || false;

/**
 * SERVICES_SUPABASE_AUTHORITATIVE (SVC-4 · Services source-of-truth cut-over)
 *
 * The Services source-of-truth cut-over — the direct analogue of
 * {@link TEAMS_SUPABASE_AUTHORITATIVE}, adapted to the global-directory shape and
 * the fact that a service can be GLOBAL (companyId === null → the Super Admin
 * catalog). It flips the authority — Supabase becomes primary — while keeping
 * localStorage as a synchronized BACKOUT copy so rollback stays instant and
 * data-free.
 *
 * When `false`: reads obey {@link SERVICES_SUPABASE_READ}; writes obey
 *   {@link SERVICES_DUAL_WRITE}; localStorage is authoritative.
 * When `true`:
 *   • READS — the service directory reads from Supabase as the PRIMARY source
 *     (this flag IMPLIES the read path even if {@link SERVICES_SUPABASE_READ} is
 *     off). On a Supabase failure / unsafe-empty the UI keeps the localStorage
 *     backout seed, but the fallback is RECORDED + surfaced — never silent.
 *   • WRITES — every write still completes synchronously against localStorage
 *     first (the backout copy, strategy B — safest, instantly reversible) and is
 *     then mirrored to Supabase, which is now the authoritative store (incl.
 *     soft-delete removal propagation). Mirror failures are recorded (never block).
 *
 * DEFAULT (P-cutover · B-area 6): this flag uses the shared {@link cutoverFlag}
 * resolver — authoritative-ON in real app builds so Services are Supabase-primary
 * and consistent across devices, OFF only under vitest so the safe-default suites
 * keep validating the localStorage path. Rollback is instant + data-free:
 * EXPO_PUBLIC_SERVICES_SUPABASE_AUTHORITATIVE=false.
 *
 * Override at build time with EXPO_PUBLIC_SERVICES_SUPABASE_AUTHORITATIVE=true|false.
 */
export const SERVICES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_SERVICES_SUPABASE_AUTHORITATIVE);

// ── Service-catalog wave (SVCCAT) — Service Categories / Payroll Groups /
//    Service Packages. Same architecture as Services: a granular read flag, a
//    granular dual-write flag, and an authoritative cut-over flag that IMPLIES
//    both. Categories + Payroll Groups support GLOBAL rows (companyId === null);
//    Packages are ALWAYS global. Rollback for any area is a single env `=false`.

/** SVCCAT · Service Categories read-path switch (granular, default OFF). */
export const SERVICE_CATEGORIES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SERVICE_CATEGORIES_SUPABASE_READ) || false;

/** SVCCAT · Service Categories write-path mirror (granular, default OFF). */
export const SERVICE_CATEGORIES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SERVICE_CATEGORIES_DUAL_WRITE) || false;

/**
 * SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE (SVCCAT · cut-over)
 *
 * The Service Categories source-of-truth cut-over — the direct analogue of
 * {@link SERVICES_SUPABASE_AUTHORITATIVE} (global-directory shape; a category can
 * be GLOBAL). Authoritative-ON in real app builds via {@link cutoverFlag}, OFF
 * under vitest. Reads reconcile the category directory from Supabase (company
 * rows + the shared global catalog); writes complete against localStorage first
 * (backout copy) then mirror to Supabase (incl. soft-delete removal). On a
 * Supabase failure / unsafe-empty the local seed is kept and surfaced — never
 * silent. Rollback: EXPO_PUBLIC_SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE=false.
 */
export const SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE);

/** SVCCAT · Payroll Groups read-path switch (granular, default OFF). */
export const PAYROLL_GROUPS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_PAYROLL_GROUPS_SUPABASE_READ) || false;

/** SVCCAT · Payroll Groups write-path mirror (granular, default OFF). */
export const PAYROLL_GROUPS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_PAYROLL_GROUPS_DUAL_WRITE) || false;

/**
 * PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE (SVCCAT · cut-over)
 *
 * The Payroll Groups source-of-truth cut-over — same model as
 * {@link SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE} (a payroll group can be
 * GLOBAL). Authoritative-ON in real app builds, OFF under vitest. Rollback:
 * EXPO_PUBLIC_PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE=false.
 */
export const PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE);

/** SVCCAT · Service Packages read-path switch (granular, default OFF). */
export const SERVICE_PACKAGES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SERVICE_PACKAGES_SUPABASE_READ) || false;

/** SVCCAT · Service Packages write-path mirror (granular, default OFF). */
export const SERVICE_PACKAGES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SERVICE_PACKAGES_DUAL_WRITE) || false;

/**
 * SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE (SVCCAT · cut-over)
 *
 * The Service Packages source-of-truth cut-over. Packages are ALWAYS global
 * master data (no companyId), so the read is the full global catalog and writes
 * never need a company mapping. Authoritative-ON in real app builds via
 * {@link cutoverFlag}, OFF under vitest. localStorage stays the synchronized
 * backout copy; writes mirror to Supabase (incl. soft-delete removal). Rollback:
 * EXPO_PUBLIC_SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE=false.
 */
export const SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE);

// ── Area cluster (AREA) — Areas / Postal Cities / Employee Languages. The
//    operational geography + language dimensions that customer visibility,
//    employee area access, customer ownership and scheduling reference by stable
//    id. Same architecture as Teams (every row is COMPANY-scoped, no globals): a
//    granular read flag, a granular dual-write flag, and an authoritative
//    cut-over flag that IMPLIES both. Rollback for any area is a single env
//    `=false`.

/** AREA · Areas read-path switch (granular, default OFF). */
export const AREAS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_AREAS_SUPABASE_READ) || false;

/** AREA · Areas write-path mirror (granular, default OFF). */
export const AREAS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_AREAS_DUAL_WRITE) || false;

/**
 * AREAS_SUPABASE_AUTHORITATIVE (AREA · cut-over)
 *
 * The Areas source-of-truth cut-over — the direct analogue of
 * {@link TEAMS_SUPABASE_AUTHORITATIVE} (company-scoped global-directory shape).
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest.
 * Reads reconcile the area directory from Supabase (company-scoped); writes
 * complete against localStorage first (backout copy) then mirror to Supabase
 * (incl. soft-delete removal). On a Supabase failure / unsafe-empty the local
 * seed is kept and surfaced — never silent. Rollback:
 * EXPO_PUBLIC_AREAS_SUPABASE_AUTHORITATIVE=false.
 */
export const AREAS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_AREAS_SUPABASE_AUTHORITATIVE);

/** AREA · Postal Cities read-path switch (granular, default OFF). */
export const POSTAL_CITIES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_POSTAL_CITIES_SUPABASE_READ) || false;

/** AREA · Postal Cities write-path mirror (granular, default OFF). */
export const POSTAL_CITIES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_POSTAL_CITIES_DUAL_WRITE) || false;

/**
 * POSTAL_CITIES_SUPABASE_AUTHORITATIVE (AREA · cut-over)
 *
 * The Postal Cities source-of-truth cut-over — same model as
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company-scoped). Authoritative-ON in real
 * app builds, OFF under vitest. Rollback:
 * EXPO_PUBLIC_POSTAL_CITIES_SUPABASE_AUTHORITATIVE=false.
 */
export const POSTAL_CITIES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_POSTAL_CITIES_SUPABASE_AUTHORITATIVE);

/** AREA · Employee Languages read-path switch (granular, default OFF). */
export const EMPLOYEE_LANGUAGES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_EMPLOYEE_LANGUAGES_SUPABASE_READ) || false;

/** AREA · Employee Languages write-path mirror (granular, default OFF). */
export const EMPLOYEE_LANGUAGES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_EMPLOYEE_LANGUAGES_DUAL_WRITE) || false;

/**
 * EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE (AREA · cut-over)
 *
 * The Employee Languages source-of-truth cut-over — same model as
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company-scoped). The single-default
 * invariant stays owned by the store; the mirror writes whatever flags the
 * localStorage record carries. Authoritative-ON in real app builds, OFF under
 * vitest. Rollback: EXPO_PUBLIC_EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE=false.
 */
export const EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE);

// ── Missions / Visit Occurrences (MISSION) — the operational execution anchor
//    (CustomerProtocol → VisitOccurrence → ProtocolRun) that check-in, mobile
//    execution and reporting attach to. The highest-priority operational area
//    still on localStorage. Same architecture as Teams/Areas (every row is
//    COMPANY-scoped, no globals): a granular read flag, a granular dual-write
//    flag, and an authoritative cut-over flag that IMPLIES both. Unlike the
//    AppContext-wired waves the standalone occurrence store fires the mirror
//    itself. Rollback is a single env `=false`.

/** MISSION · Visit Occurrences read-path switch (granular, default OFF). */
export const VISIT_OCCURRENCES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_VISIT_OCCURRENCES_SUPABASE_READ) || false;

/** MISSION · Visit Occurrences write-path mirror (granular, default OFF). */
export const VISIT_OCCURRENCES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_VISIT_OCCURRENCES_DUAL_WRITE) || false;

/**
 * VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE (MISSION · cut-over)
 *
 * The Missions source-of-truth cut-over — the same model as
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company-scoped). Authoritative-ON in real
 * app builds via {@link cutoverFlag}, OFF under vitest so the safe-default suites
 * keep validating the localStorage path. Reads reconcile occurrences from
 * Supabase (company-scoped); writes complete against localStorage first (backout
 * copy) then mirror to Supabase. On a Supabase failure / unsafe-empty the local
 * seed is kept and surfaced — never silent. Rollback:
 * EXPO_PUBLIC_VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE=false.
 */
export const VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE);

// ── Identity wave (ROLE / USER) — the single identity model. Profiles are
//    already the global Supabase identity backbone; this wave moves the two
//    remaining localStorage-authoritative identity stores — Roles & Permissions
//    (role definitions) and the Users/logins directory — onto Supabase so the
//    whole identity graph (auth user → profile → employee → role assignment) is
//    Supabase-sourced and consistent across devices. Both areas support GLOBAL
//    rows (companyId === null: Super Admin role templates, platform super-admin
//    logins), so they mirror the Services architecture: a granular read flag, a
//    granular dual-write flag, and an authoritative cut-over flag that IMPLIES
//    both. Rollback for either area is a single env `=false`.

/** ROLE · Roles & Permissions read-path switch (granular, default OFF). */
export const ROLES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ROLES_SUPABASE_READ) || false;

/** ROLE · Roles & Permissions write-path mirror (granular, default OFF). */
export const ROLES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ROLES_DUAL_WRITE) || false;

/**
 * ROLES_SUPABASE_AUTHORITATIVE (ROLE · cut-over)
 *
 * The Roles & Permissions source-of-truth cut-over — the direct analogue of
 * {@link SERVICES_SUPABASE_AUTHORITATIVE} (global-directory shape; a role can be
 * a GLOBAL Super Admin template). Authoritative-ON in real app builds via
 * {@link cutoverFlag}, OFF under vitest so the safe-default suites keep
 * validating the localStorage path. Reads reconcile the role directory from
 * Supabase (company rows + the shared global templates); writes complete against
 * localStorage first (backout copy) then mirror to Supabase (incl. soft-delete
 * removal). On a Supabase failure / unsafe-empty the local seed is kept and
 * surfaced — never silent. Rollback:
 * EXPO_PUBLIC_ROLES_SUPABASE_AUTHORITATIVE=false.
 */
export const ROLES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_ROLES_SUPABASE_AUTHORITATIVE);

/** USER · Users/logins directory read-path switch (granular, default OFF). */
export const USERS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_USERS_SUPABASE_READ) || false;

/** USER · Users/logins directory write-path mirror (granular, default OFF). */
export const USERS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_USERS_DUAL_WRITE) || false;

/**
 * USERS_SUPABASE_AUTHORITATIVE (USER · cut-over)
 *
 * The Users/logins source-of-truth cut-over — the same model as
 * {@link ROLES_SUPABASE_AUTHORITATIVE} (a login can be a GLOBAL platform super
 * admin, companyId === null). This moves the localStorage `cleanops.users`
 * credential/login DIRECTORY onto Supabase (the app-facing {@link User} login
 * record — distinct from, and complementary to, the existing Supabase `profiles`
 * identity backbone). Passwords are NEVER mirrored: the `data` payload carries
 * only the non-secret login record, and admin authentication continues to run
 * exclusively through Supabase Auth. Authoritative-ON in real app builds via
 * {@link cutoverFlag}, OFF under vitest. Reads reconcile the login directory from
 * Supabase (company rows + global super-admin logins); writes complete against
 * localStorage first (backout copy) then mirror to Supabase (incl. soft-delete
 * removal). On a Supabase failure / unsafe-empty the local seed is kept and
 * surfaced — never silent. Rollback:
 * EXPO_PUBLIC_USERS_SUPABASE_AUTHORITATIVE=false.
 */
export const USERS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_USERS_SUPABASE_AUTHORITATIVE);

/** TIMECODE · Time Code library read-path switch (granular, default OFF). */
export const TIME_CODES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TIME_CODES_SUPABASE_READ) || false;

/** TIMECODE · Time Code library write-path mirror (granular, default OFF). */
export const TIME_CODES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TIME_CODES_DUAL_WRITE) || false;

/**
 * TIME_CODES_SUPABASE_AUTHORITATIVE (TIMECODE · cut-over · Payroll/Time domain)
 *
 * The Time Code library source-of-truth cut-over — the direct analogue of
 * {@link ROLES_SUPABASE_AUTHORITATIVE} (global-directory shape; a time code can
 * be a GLOBAL Super Admin master-library code, companyId === null). This is the
 * payroll-foundation entity: services.timeCodeId / time reports soft-reference a
 * code by its legacy id, so its stability anchors the whole Payroll/Time domain.
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest
 * so the safe-default suites keep validating the localStorage path. Reads
 * reconcile the code directory from Supabase (company rows + the shared global
 * master library); writes complete against localStorage first (backout copy)
 * then mirror to Supabase (incl. soft-delete removal). On a Supabase failure /
 * unsafe-empty the local seed is kept and surfaced — never silent. Rollback:
 * EXPO_PUBLIC_TIME_CODES_SUPABASE_AUTHORITATIVE=false.
 */
export const TIME_CODES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_TIME_CODES_SUPABASE_AUTHORITATIVE);

// ── Booking Queue (BQ) — the PLANNING layer between Work Orders and the future
//    Schedule module. Every work-order service row produces one queue item that
//    carries snapshot planning values. Same architecture as Areas (every row is
//    COMPANY-scoped, no globals): a granular read flag, a granular dual-write
//    flag, and an authoritative cut-over flag that IMPLIES both. The queue is
//    AppContext-wired (persistBookingQueue). Booking Queue is explicitly the
//    PLANNING/operational queue ONLY — it is NOT a payroll/billing structure, so
//    it is safe to migrate now while Time Reports / Invoices / Payroll stay
//    paused. Clean authoritative empty Supabase reads stay empty; local fallback
//    is only allowed for read failures or the explicit temporary bridge below.
//    Rollback is a single env `=false`.

/** BQ · Booking Queue read-path switch (granular, default OFF). */
export const BOOKING_QUEUE_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_BOOKING_QUEUE_SUPABASE_READ) || false;

/** BQ · Booking Queue write-path mirror (granular, default OFF). */
export const BOOKING_QUEUE_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_BOOKING_QUEUE_DUAL_WRITE) || false;

/**
 * BOOKING_QUEUE_SUPABASE_AUTHORITATIVE (BQ · cut-over)
 *
 * The Booking Queue source-of-truth cut-over — the direct analogue of
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company-scoped, no globals).
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest
 * so the safe-default suites keep validating the localStorage path. Reads
 * reconcile the queue directory from Supabase (company-scoped); writes complete
 * against localStorage first (backout copy) then mirror to Supabase (incl.
 * soft-delete removal). On a Supabase read failure the local backout copy may be
 * kept and surfaced — never silent. A clean successful empty Supabase read is
 * authoritative and must remain empty. Rollback:
 * EXPO_PUBLIC_BOOKING_QUEUE_SUPABASE_AUTHORITATIVE=false.
 */
export const BOOKING_QUEUE_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_BOOKING_QUEUE_SUPABASE_AUTHORITATIVE);

/**
 * BQ · Temporary local-backout bridge for explicitly unsafe empty reads.
 *
 * Default OFF. This is technical debt for controlled migration/backout windows
 * only: it permits local Booking Queue rows to remain visible when Supabase
 * returns empty AND operators have explicitly declared that empty read unsafe.
 * Clean authoritative empty reads must not use this fallback.
 */
export const BOOKING_QUEUE_LOCAL_BACKOUT_BRIDGE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_BOOKING_QUEUE_LOCAL_BACKOUT_BRIDGE) || false;

// ── Settings (SET) — the Settings domain has two stores: settings_templates
//    (ALWAYS global Super-Admin master data, like service_packages) and
//    company_settings (one COMPANY-scoped record per company, keyed by
//    companyId). Both wrap a SettingsData blob. Each gets a granular read flag, a
//    granular dual-write flag, and an authoritative cut-over flag that IMPLIES
//    both. Rollback for either is a single env `=false`.

/** SET · Settings Templates read-path switch (granular, default OFF). */
export const SETTINGS_TEMPLATES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SETTINGS_TEMPLATES_SUPABASE_READ) || false;

/** SET · Settings Templates write-path mirror (granular, default OFF). */
export const SETTINGS_TEMPLATES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SETTINGS_TEMPLATES_DUAL_WRITE) || false;

/**
 * SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE (SET · cut-over)
 *
 * The Settings Templates source-of-truth cut-over — the direct analogue of
 * {@link SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE} (always-global master data).
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest.
 * Reads reconcile the global template catalog from Supabase; writes complete
 * against localStorage first (backout copy) then mirror to Supabase (incl.
 * soft-delete removal). On a Supabase failure / unsafe-empty the local seed is
 * kept and surfaced — never silent. Rollback:
 * EXPO_PUBLIC_SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE=false.
 */
export const SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE);

/** SET · Company Settings read-path switch (granular, default OFF). */
export const COMPANY_SETTINGS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_COMPANY_SETTINGS_SUPABASE_READ) || false;

/** SET · Company Settings write-path mirror (granular, default OFF). */
export const COMPANY_SETTINGS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_COMPANY_SETTINGS_DUAL_WRITE) || false;

/**
 * COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE (SET · cut-over)
 *
 * The Company Settings source-of-truth cut-over — the direct analogue of
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company-scoped; one record per company,
 * keyed by companyId). Authoritative-ON in real app builds via
 * {@link cutoverFlag}, OFF under vitest. Reads reconcile the company-scoped
 * settings record from Supabase; writes complete against localStorage first
 * (backout copy) then mirror to Supabase (incl. soft-delete removal). On a
 * Supabase failure / unsafe-empty the local seed is kept and surfaced — never
 * silent. Rollback: EXPO_PUBLIC_COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE=false.
 */
export const COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE);

// ── Modules / Checklists / Protocols / Media (MCPM) — the final localStorage
//    retirement wave. Modules / Module Categories are GLOBAL master data (reuse
//    the settings_templates model); company_modules is COMPANY-scoped.
//    Checklist templates are GLOBAL or COMPANY (reuse the roles model);
//    customer protocols are COMPANY + customer scoped; media is COMPANY-scoped.
//    Each area gets a granular read flag, a granular dual-write flag, and an
//    authoritative cut-over flag that IMPLIES both. Rollback is a single env
//    `=false`.

/** MCPM · Modules domain read-path switch (granular, default OFF). */
export const MODULES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MODULES_SUPABASE_READ) || false;

/** MCPM · Modules domain write-path mirror (granular, default OFF). */
export const MODULES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MODULES_DUAL_WRITE) || false;

/**
 * MODULES_SUPABASE_AUTHORITATIVE (MCPM · cut-over)
 *
 * The Modules domain (global modules + categories catalogue, company-scoped
 * config) source-of-truth cut-over. Modules / categories reuse the
 * settings_templates global model; company_modules reuses the Areas
 * company-scoped model. Authoritative-ON in real app builds via
 * {@link cutoverFlag}, OFF under vitest. Reads reconcile the catalogue from
 * Supabase; writes complete against localStorage first (backout copy) then
 * mirror to Supabase (incl. soft-delete removal). On a Supabase failure /
 * unsafe-empty the local seed is kept and surfaced — never silent. Rollback:
 * EXPO_PUBLIC_MODULES_SUPABASE_AUTHORITATIVE=false.
 */
export const MODULES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_MODULES_SUPABASE_AUTHORITATIVE);

/** MCPM · Checklist Templates read-path switch (granular, default OFF). */
export const CHECKLIST_TEMPLATES_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CHECKLIST_TEMPLATES_SUPABASE_READ) || false;

/** MCPM · Checklist Templates write-path mirror (granular, default OFF). */
export const CHECKLIST_TEMPLATES_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CHECKLIST_TEMPLATES_DUAL_WRITE) || false;

/**
 * CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE (MCPM · cut-over)
 *
 * The Checklist Templates source-of-truth cut-over — the direct analogue of
 * {@link ROLES_SUPABASE_AUTHORITATIVE} (a template can be a GLOBAL best-practice
 * library entry, companyId === null, as well as company-owned). The full nested
 * template → sections → items hierarchy is carried losslessly per row.
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest.
 * Reads reconcile the directory from Supabase (company templates + the shared
 * global library); writes complete against localStorage first (backout copy)
 * then mirror to Supabase (incl. soft-delete removal). Rollback:
 * EXPO_PUBLIC_CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE=false.
 */
export const CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE);

/** MCPM · Customer Protocols read-path switch (granular, default OFF). */
export const CUSTOMER_PROTOCOLS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CUSTOMER_PROTOCOLS_SUPABASE_READ) || false;

/** MCPM · Customer Protocols write-path mirror (granular, default OFF). */
export const CUSTOMER_PROTOCOLS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_CUSTOMER_PROTOCOLS_DUAL_WRITE) || false;

/**
 * CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE (MCPM · cut-over)
 *
 * The Customer Protocols source-of-truth cut-over — the same model as
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company + customer scoped, no globals).
 * The full nested protocol → sections → items hierarchy is carried losslessly
 * per row. Authoritative-ON in real app builds via {@link cutoverFlag}, OFF
 * under vitest. Reads reconcile the directory from Supabase (company-scoped);
 * writes complete against localStorage first (backout copy) then mirror to
 * Supabase (incl. soft-delete removal). Rollback:
 * EXPO_PUBLIC_CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE=false.
 */
export const CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE);

/** MCPM · Media Assets read-path switch (granular, default OFF). */
export const MEDIA_ASSETS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MEDIA_ASSETS_SUPABASE_READ) || false;

/** MCPM · Media Assets write-path mirror (granular, default OFF). */
export const MEDIA_ASSETS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MEDIA_ASSETS_DUAL_WRITE) || false;

/**
 * MEDIA_ASSETS_SUPABASE_AUTHORITATIVE (MCPM · cut-over)
 *
 * The Media Assets source-of-truth cut-over — the same model as
 * {@link AREAS_SUPABASE_AUTHORITATIVE} (company-scoped, no globals). The lossless
 * asset record (the three thumbnail/preview URLs + content metadata) is carried
 * per row; binary originals are never stored (the store only ever persists the
 * processed layers). Authoritative-ON in real app builds via {@link cutoverFlag},
 * OFF under vitest. Reads reconcile the directory from Supabase; writes complete
 * against localStorage first (backout copy) then mirror to Supabase (incl.
 * soft-delete removal). Rollback:
 * EXPO_PUBLIC_MEDIA_ASSETS_SUPABASE_AUTHORITATIVE=false.
 */
export const MEDIA_ASSETS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_MEDIA_ASSETS_SUPABASE_AUTHORITATIVE);

// ── Service Entitlements (ENT) — the paid-add-on governance backbone. THREE
//    localStorage stores migrate together: serviceGlobalEntitlements (GLOBAL
//    master data, like service_packages), companyServiceEntitlements
//    (COMPANY-scoped tri-state access) and serviceEntitlementLog (immutable
//    append-only trail). This is Super-Admin operational data that was a real
//    source-of-truth dependency keeping the Super Admin area "partial". One
//    granular read flag, one granular dual-write flag, and an authoritative
//    cut-over flag that IMPLIES both, govern all three stores together. Rollback
//    is a single env `=false`.

/** ENT · Service Entitlements read-path switch (granular, default OFF). */
export const ENTITLEMENTS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ENTITLEMENTS_SUPABASE_READ) || false;

/** ENT · Service Entitlements write-path mirror (granular, default OFF). */
export const ENTITLEMENTS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ENTITLEMENTS_DUAL_WRITE) || false;

/**
 * ENTITLEMENTS_SUPABASE_AUTHORITATIVE (ENT · cut-over)
 *
 * The Service Entitlements source-of-truth cut-over — spanning the global
 * entitlements (always-global master data, like
 * {@link SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE}), the company entitlements
 * (company-scoped, like {@link AREAS_SUPABASE_AUTHORITATIVE}) and the immutable
 * append-only entitlement log. Authoritative-ON in real app builds via
 * {@link cutoverFlag}, OFF under vitest so the safe-default suites keep
 * validating the localStorage path. Reads reconcile all three stores from
 * Supabase (global readable to all, company rows scoped); writes complete
 * against localStorage first (backout copy) then mirror to Supabase (upsert +
 * soft-delete removal for the two mutable stores, append-only insert for the
 * log). On a Supabase failure / unsafe-empty the local seed is kept and surfaced
 * — never silent. Rollback:
 * EXPO_PUBLIC_ENTITLEMENTS_SUPABASE_AUTHORITATIVE=false.
 */
export const ENTITLEMENTS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_ENTITLEMENTS_SUPABASE_AUTHORITATIVE);

// ── Activity Log (ACTIVITY) — the append-only audit trail (cleanops.auditEvents
//    → activity_events). An immutable, company-scoped log (companyId === null =
//    platform-level events). Unlike the directory waves there are NO updates or
//    removals — the mirror is append-only — and the local store is hard-capped
//    at the newest 500 events. One granular read flag, one granular dual-write
//    (append) flag, and an authoritative cut-over flag that IMPLIES both.
//    Rollback is a single env `=false`.

/** ACTIVITY · Activity Log read-path switch (granular, default OFF). */
export const ACTIVITY_LOG_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ACTIVITY_LOG_SUPABASE_READ) || false;

/** ACTIVITY · Activity Log write-path (append) mirror (granular, default OFF). */
export const ACTIVITY_LOG_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ACTIVITY_LOG_DUAL_WRITE) || false;

/**
 * ACTIVITY_LOG_SUPABASE_AUTHORITATIVE (ACTIVITY · cut-over)
 *
 * The Activity Log source-of-truth cut-over — a company-scoped, append-only
 * audit trail (companyId === null for platform-level events). Reads are scoped
 * exactly like {@link AREAS_SUPABASE_AUTHORITATIVE} but the WRITE path is
 * append-only: new audit events are inserted, never updated or removed, and the
 * local store stays hard-capped at the newest 500 as a backout copy.
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest.
 * Reads reconcile recent events from Supabase (company + platform scope); on a
 * Supabase failure / unsafe-empty the local seed is kept and surfaced — never
 * silent. Rollback: EXPO_PUBLIC_ACTIVITY_LOG_SUPABASE_AUTHORITATIVE=false.
 */
export const ACTIVITY_LOG_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_ACTIVITY_LOG_SUPABASE_AUTHORITATIVE);

// ── System Settings (SYSSET) — the platform-level (Master Admin) configuration
//    record (cleanops.systemSettings → system_settings). A SINGLETON global
//    record (no company scope, exactly one row for the whole installation)
//    carrying the booking-generation horizon, the Preferred Time Evaluation
//    master gate and the entitlement-resolver controls. It is the LONE remaining
//    in-scope source-of-truth gap keeping the Super Admin area "partial". One
//    granular read flag, one granular dual-write flag, and an authoritative
//    cut-over flag that IMPLIES both. Rollback is a single env `=false`.

/** SYSSET · System Settings read-path switch (granular, default OFF). */
export const SYSTEM_SETTINGS_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SYSTEM_SETTINGS_SUPABASE_READ) || false;

/** SYSSET · System Settings write-path mirror (granular, default OFF). */
export const SYSTEM_SETTINGS_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_SYSTEM_SETTINGS_DUAL_WRITE) || false;

/**
 * SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE (SYSSET · cut-over)
 *
 * The System Settings source-of-truth cut-over — the direct analogue of
 * {@link SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE} (always-global master data),
 * reduced to a SINGLETON: there is exactly ONE global system-settings record.
 * Authoritative-ON in real app builds via {@link cutoverFlag}, OFF under vitest
 * so the safe-default suites keep validating the localStorage path. Reads
 * reconcile the single record from Supabase; writes complete against localStorage
 * first (backout copy) then mirror to Supabase. On a Supabase failure /
 * unsafe-empty (no row yet) the local seed is kept and surfaced — never silent.
 * Rollback: EXPO_PUBLIC_SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE=false.
 */
export const SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE: boolean =
  cutoverFlag(import.meta.env.EXPO_PUBLIC_SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE);

// ── Mission Log (MISSIONLOG) — the Operational Execution EXECUTION LEDGER
//    (mission_log_entries / mission_staff_sessions / mission_log_events /
//    mission_booked_time_ratings, migration 0031). Phase 2a-1 ships the SCHEMA
//    FOUNDATION ONLY — there is NO repository, Supabase adapter, read seam,
//    dual-write or behaviour wired to these tables yet. So unlike the completed
//    migration waves these flags use {@link envFlag} and DEFAULT OFF (NOT the
//    cutover resolver, which would resolve authoritative-ON in app builds): with
//    nothing reading or writing the tables, an authoritative-by-default flag
//    would be meaningless and unsafe. The granular read / dual-write / cut-over
//    triad mirrors the established convention so the later behavioural waves can
//    flip them on without renaming. Mission Log is execution-ledger only — these
//    flags never gate Schedule, payroll, invoice or time-bank behaviour.

/** MISSIONLOG · Mission Log read-path switch (granular, default OFF). */
export const MISSION_LOG_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MISSION_LOG_SUPABASE_READ) || false;

/** MISSIONLOG · Mission Log write-path mirror (granular, default OFF). */
export const MISSION_LOG_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE) || false;

/**
 * MISSION_LOG_SUPABASE_AUTHORITATIVE (MISSIONLOG · cut-over · reserved)
 *
 * The Mission Log source-of-truth cut-over flag — RESERVED for a later
 * behavioural wave. Phase 2a-1 is schema-only: no repository, adapter, read seam
 * or dual-write exists, so this DELIBERATELY uses {@link envFlag} and stays
 * DEFAULT OFF (it does NOT use {@link cutoverFlag}, which would resolve ON in app
 * builds). It will switch to the cutover resolver only once the read seam +
 * dual-write mirror are built and validated, exactly like the other operational
 * areas. Until then nothing in the app reads it. Rollback / opt-in:
 * EXPO_PUBLIC_MISSION_LOG_SUPABASE_AUTHORITATIVE=true|false.
 */
export const MISSION_LOG_SUPABASE_AUTHORITATIVE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_MISSION_LOG_SUPABASE_AUTHORITATIVE) || false;

// ── Time Reporting (TIMEREPORTING) — the Operational Execution APPROVAL,
//    ADJUSTMENT and TIME-CLASSIFICATION workspace (time_reports /
//    time_allocations / time_deviation_reason_codes / time_report_events /
//    time_report_flags / time_report_flag_events / time_report_messages /
//    saved_filters / saved_review_queues, migration 0032). Phase 2a-2 ships the
//    SCHEMA FOUNDATION ONLY — there is NO repository, Supabase adapter, read
//    seam, dual-write, checkout cut-over, bulk mutation or behaviour wired to
//    these tables yet. So exactly like the Mission Log flags these use
//    {@link envFlag} and DEFAULT OFF (NOT the cutover resolver, which would
//    resolve authoritative-ON in app builds): with nothing reading or writing
//    the tables an authoritative-by-default flag would be meaningless and unsafe.
//    The granular read / dual-write / cut-over triad mirrors the established
//    convention so the later behavioural waves can flip them on without
//    renaming. Time Reporting NEVER writes payroll basis, writes invoice basis,
//    affects the time bank or makes AI decisions (AI only ADVISES).

/** TIMEREPORTING · Time Reporting read-path switch (granular, default OFF). */
export const TIME_REPORTING_SUPABASE_READ: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TIME_REPORTING_SUPABASE_READ) || false;

/** TIMEREPORTING · Time Reporting write-path mirror (granular, default OFF). */
export const TIME_REPORTING_DUAL_WRITE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE) || false;

/**
 * TIME_REPORTING_SUPABASE_AUTHORITATIVE (TIMEREPORTING · cut-over · reserved)
 *
 * The Time Reporting source-of-truth cut-over flag — RESERVED for a later
 * behavioural wave (the legacy checkout `TimeReport` cut-over). Phase 2a-2 is
 * schema-only: no repository, adapter, read seam or dual-write exists, so this
 * DELIBERATELY uses {@link envFlag} and stays DEFAULT OFF (it does NOT use
 * {@link cutoverFlag}, which would resolve ON in app builds). It will switch to
 * the cutover resolver only once the read seam + dual-write mirror are built and
 * validated, exactly like the other operational areas. Until then nothing in the
 * app reads it. Rollback / opt-in:
 * EXPO_PUBLIC_TIME_REPORTING_SUPABASE_AUTHORITATIVE=true|false.
 */
export const TIME_REPORTING_SUPABASE_AUTHORITATIVE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TIME_REPORTING_SUPABASE_AUTHORITATIVE) || false;

/**
 * TIME_REPORTING_SHADOW_VALIDATE (TIMEREPORTING · parity/shadow validation · Slice 2d-2)
 *
 * The independent gate for the Operational Execution PARITY runner — it controls
 * ONLY whether the read-only parity/shadow validation ({@link
 * import("./timeReportingParityRunner")}) is allowed to fetch legacy + Supabase
 * rows, run the pure comparators ({@link import("./timeReportingParity")} /
 * {@link import("./missionLogParity")}) and record sanitized telemetry.
 *
 * DELIBERATELY {@link envFlag} + DEFAULT OFF (NOT the cutover resolver). This flag
 * NEVER switches live reads, NEVER blocks or alters checkout, NEVER changes the
 * UI and writes nothing — it is purely an opt-in for validation runs. It can be
 * enabled independently AFTER {@link TIME_REPORTING_DUAL_WRITE} (and optionally
 * {@link MISSION_LOG_DUAL_WRITE}) so the new Operational Execution rows actually
 * exist to compare. Rollback / opt-in:
 * EXPO_PUBLIC_TIME_REPORTING_SHADOW_VALIDATE=true|false.
 */
export const TIME_REPORTING_SHADOW_VALIDATE: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_TIME_REPORTING_SHADOW_VALIDATE) || false;

// ── REQUEST CRM (Slice 0 — frontend shell + mock data only) ──────────────────
//    The REQUEST CRM build starts as a feature-flagged, shared-admin-only,
//    read-only frontend shell. These flags follow the granular {@link envFlag}
//    convention and stay DEFAULT OFF: an unflipped build renders NO new routes,
//    nav entries or UI. There is no backend, no migration, no localStorage
//    authority and no runtime enforcement behind them — they only reveal a
//    mock/read-only surface. Rollback for any flag is a single env `=false`.
//    Runtime flags / kill switches remain owned by Automation & AI Center.

/**
 * ENABLE_REQUEST_CRM_FRONTEND_SHELL (REQUEST CRM · master shell flag)
 *
 * When `false` (default): the REQUEST CRM surface does not exist — no `/crm/*`
 *   route is registered and no REQUEST CRM nav entry is shown. The rest of the
 *   app is completely unaffected.
 * When `true`: the feature-flagged REQUEST CRM shell becomes reachable for shared
 *   admins (super_admin + company_admin), gated additionally by the relevant
 *   sub-shell flag and permission. Mock/read-only only — no backend, no writes,
 *   no live automation/AI/notifications/runtime guards.
 *
 * Override at build time with EXPO_PUBLIC_ENABLE_REQUEST_CRM_FRONTEND_SHELL=true.
 */
export const ENABLE_REQUEST_CRM_FRONTEND_SHELL: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ENABLE_REQUEST_CRM_FRONTEND_SHELL) || false;

/**
 * ENABLE_REQUEST_CRM_SETTINGS_SHELL (REQUEST CRM · settings sub-shell)
 *
 * When `false` (default): the REQUEST CRM Settings Shell route (`/crm/settings`)
 *   and its nav entry do not exist, even if the master shell flag is on.
 * When `true` (and the master shell flag is also on): the read-only settings
 *   shell at `/crm/settings(/:tab)` becomes available to shared admins holding
 *   `requests.settings.view`. Every section renders mock/read-only data and all
 *   write controls are disabled placeholders.
 *
 * Override at build time with EXPO_PUBLIC_ENABLE_REQUEST_CRM_SETTINGS_SHELL=true.
 */
export const ENABLE_REQUEST_CRM_SETTINGS_SHELL: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ENABLE_REQUEST_CRM_SETTINGS_SHELL) || false;

/**
 * ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW (REQUEST CRM · quick-review preview)
 *
 * When `false` (default): the AI & Automation and Runtime Safety Links settings
 *   sections show their read-only rows plus an explanatory "preview disabled"
 *   note — no automation candidate / runtime-safety cards are rendered.
 * When `true`: those sections additionally render DISPLAY-ONLY automation
 *   quick-review and mock runtime-safety badges sourced from the REQUEST CRM
 *   mock fixtures. This never enables enforcement — Automation & AI Center stays
 *   the single source of truth for automation, AI, risk and runtime guards.
 *
 * Override at build time with EXPO_PUBLIC_ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW=true.
 */
export const ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW: boolean =
  envFlag(import.meta.env.EXPO_PUBLIC_ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW) || false;
