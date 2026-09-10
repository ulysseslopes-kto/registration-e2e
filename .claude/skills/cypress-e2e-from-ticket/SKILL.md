---
name: cypress-e2e-from-ticket
description: Write Cypress E2E tests (mocked by default, integrated on request; "new" Registration-2026 flow by default, legacy on request) for a mono-fe feature, given a Jira ticket (e.g. KIB-8557) and optional flags ("KIB-8557 integrated legacy"). Investigates the ticket's linked/open PR in techmobilt/mono-fe directly from source (not the ticket description, which is often stale or a placeholder), maps every backend endpoint and its response envelope, picks the fastest reliable entry point into the screen under test, writes the spec following this repo's conventions, and verifies it against a real PR preview before calling it done. Use when the user asks to "criar testes para <ticket>", write E2E coverage for a mono-fe PR, or add Cypress specs for a feature already in code review.
---

# Cypress E2E tests from a Jira ticket

Goal: working, verified Cypress specs in `registration-e2e` for a feature that
already has code in `techmobilt/mono-fe` — not tests that merely compile, but
tests confirmed to pass against the real thing.

## 0. Pick the mode

`registration-e2e` has two independent suites (`cypress.config.ts`) — decide
which one the user wants before doing anything else:

- **`mocked`** (default — use this unless told otherwise): every business
  endpoint intercepted, no VPN, no shared mutable state, safe to run
  repeatedly and to gate a PR. This is what the rest of this skill assumes.
- **`integrated`**: drives the real UI against the real dev/stg backend with
  one shared test identity (`FLOW_TEST_CPF` etc., `.env`). Needs VPN, and
  running it for real mutates that shared identity (recycling/creating a real
  player) — never run an integrated spec against a live backend without the
  user's explicit go-ahead first, same as any other action that touches
  shared state outside this sandbox. See step 4b/5b below.

Read the mode off the user's own words: an explicit "integrated" (or "contra
o backend real", "sem mock") means integrated; anything else, including no
mode mentioned at all, means mocked.

## 0b. Pick the flow variant

mono-fe currently carries two parallel UI implementations of registration and
login, both mirrored in this repo's own folder split
(`cypress/e2e/{mocked,integrated}/{legacy,new}/`):

- **`new`** (default — use this unless told otherwise): "Registration 2026",
  `modules/registration`'s component tree (`AccountCreateFlow`,
  `activation-flow`, ...), behind `fe_igp_registration_new_ui_experience:
  true`. This is where active development happens — KIB-8557's RG limits
  screen, this skill's worked example throughout, is a `new`-only feature.
- **`legacy`**: the pre-existing `apps/core` component tree
  (`RegisterContent`/`RegisterModal`, old DOM ids like `#national_id`), same
  flag `false`. Being phased out, but still what real traffic hits until a
  given surface's `new` counterpart ships and the flag flips.

Same reading rule as the mode: an explicit "legacy" means legacy, anything
else (including nothing said) means `new`.

**Don't assume both variants exist for the feature at hand** — check source
(step 2) rather than mirroring blindly. Some features are `new`-only (no
legacy equivalent ever existed, e.g. the RG limits redesign lives only in
`modules/registration`); some are the reverse, still legacy-only with no
`new` port yet. Where a feature genuinely has both (registration and login
themselves do — see `cypress/e2e/mocked/legacy/registration/registration.cy.ts`
vs. `cypress/e2e/mocked/new/registration/account-create.cy.ts` for how the
same journey reads in each), the two specs typically differ in selectors and
a couple of endpoints (e.g. `/cpf/check/v3` vs. `/cpf-checks/v4`) but the
same conventions apply to both.

## 1. Find the real spec — not the ticket

The Jira description is the *intent*, often written before implementation and
never updated (ACs can say "placeholder" while the PR is already in Code
Review). The PR is the *truth*.

1. Fetch the ticket (`mcp__claude_ai_Atlassian_Rovo__getJiraIssue`, cloudId
   `mobiltoperations.atlassian.net`) for summary/status/labels — mainly to
   confirm it's real and get the feature area.
2. Find its branch/PR: `gh pr list --repo techmobilt/mono-fe --search "<TICKET-ID>" --state all`.
   Branch name is usually the ticket ID.
3. Read the PR body (`gh pr view <n> --repo techmobilt/mono-fe --json body -q .body`)
   — a well-written description (like #2193 for KIB-8557) already gives you
   flag names, endpoint contracts, and a manual "Steps to Test" section other
   engineers wrote for exactly this purpose. Treat it as a lead to verify
   against source, not as ground truth by itself.

## 2. Read the actual source, don't guess selectors or payloads

`mono-fe` may be checked out on an unrelated branch locally with uncommitted
work — never `git checkout`/`switch` it. Read the PR's branch without
touching the working tree:

```bash
git -C /path/to/mono-fe fetch origin <TICKET-ID>
git -C /path/to/mono-fe show origin/<TICKET-ID>:path/to/file.tsx
git -C /path/to/mono-fe diff main origin/<TICKET-ID> -- path/to/dir
```

For each screen/flow under test, trace and note down:

- **Component tree**: which page mounts it, behind which GrowthBook flag(s)
  (`useFeatureIsOn`/`useFeatureValue` calls), and what state/props gate it
  actually rendering (a flag being on is necessary but often not sufficient —
  e.g. `isActivationPending` also had to be `true`, which itself required a
  specific, easy-to-get-backwards field value).
- **Every network call** the component (and everything it's nested inside —
  provider trees fire their own calls the moment `isLoggedIn`/similar flips)
  makes, with the exact request/response shape. In this codebase specifically:
  check whether the adapter passes `{ hasNestedData: false }` or uses the
  default (`true`) — that decides whether your stubbed response body needs a
  `{ data: ... }` wrapper. Getting this wrong doesn't error, it just silently
  makes the hook see `undefined` and the UI never appears — the single most
  time-consuming class of bug in this kind of work.
- **Real selectors**: DOM ids, class names shared between multiple otherwise
  ambiguous elements (two buttons sharing one class is common with CVA/shared
  variant styles — assume it, verify it, don't rely on a single class alone
  for anything you're about to click), and literal copy strings, sourced from
  the `*_FALLBACK` constants next to their translation keys — CMS-only keys
  not yet added render their fallback in every test environment, so fallback
  text is safe and correct to assert on.

## 3. Pick the fastest reliable entry point

Before wiring up a full form flow (registration, checkout, etc.) to reach one
screen, check whether the app has a shortcut: a lobby/dashboard entry point
that opens the same modal/screen for an already-logged-in user. If
`authProvider`-equivalent code decides "logged in" from `localStorage`
synchronously (no network call — check this explicitly, don't assume), a
`cy.visit(path, { onBeforeLoad })` that seeds those keys directly is far
faster and more focused than driving an entire unrelated flow just to reach
the screen under test. This repo has `cy.visitAsLoggedInUser()` +
`cy.stubActiveSession()` for exactly this pattern — extend `stubActiveSession`
rather than duplicating it if the new screen needs another global-provider
call stubbed.

## 4a. Write the spec (mocked)

Follow this repo's existing conventions (read a recent spec in
`cypress/e2e/mocked/` first — `cypress/e2e/mocked/new/activation/limits.cy.ts`
is a good current reference for this exact pattern):

- A header comment citing real file paths and explaining *why*, not *what* —
  especially any deliberate scope cut (why a scenario isn't covered) and any
  non-obvious selector choice.
- Small helpers for repeated multi-step navigation (`openXScreen`,
  `chooseYOption`), not copy-pasted step sequences per test.
- New backend stubs go in `cypress/support/commands.ts` as `stub*` commands
  matching the file's existing style (JSDoc explaining the endpoint, who
  calls it, and the response envelope), not inline in the spec — unless a
  single test needs a one-off variant (e.g. one endpoint failing), which is
  fine to intercept locally in that `it()`.
- Route any incidental/unrelated network call your entry-point strategy
  surfaces (a global provider posting its own default on login, e.g. this
  codebase's `RealityCheckProvider`) to its own alias, so it never pollutes
  the alias your assertions actually wait on.

## 4b. Write the spec (integrated) — only when the user asked for it

File goes in `cypress/e2e/integrated/<area>/<name>.cy.ts`, mirroring the
mocked file it pairs with. Read
`cypress/e2e/integrated/new/registration.cy.ts` and
`cypress/e2e/integrated/new/login.cy.ts` first — real conventions, not
guesses:

- Every `describe` starts with the defensive skip guard:
  ```ts
  before(function () {
    if (Cypress.env('mode') !== 'integrated') this.skip()
  })
  ```
- Nothing is `cy.intercept()`-stubbed except what is genuinely impossible to
  satisfy for real in an automated run (e.g. an OTP mailed to an inbox
  nothing in CI can read). Where you do stub a client-side check like that,
  check whether the real backend still enforces the thing you faked
  client-side — if so, satisfy it for real via a `commands/api.ts`
  test-support call (`cy.request` straight to the internal gateway,
  VPN-only), not by stubbing further. GrowthBook stays real too; pin only the
  flag(s) the spec needs deterministic via
  `cy.overrideGrowthbookFeature(key, value)` (patches one key on top of the
  live response), never `cy.stubGrowthbookFeatures()` (replaces it entirely).
  `fe_igp_registration_new_ui_experience` specifically is always one of
  them, regardless of what else the spec needs pinned — it decides which
  whole UI tree (legacy vs. new) renders at all, so leaving it live means
  the spec silently starts hitting the wrong component tree the day the
  live default flips (which it will, as new/legacy migrations progress).
  Pin it `false` for a `legacy`-variant spec, `true` for `new` — every
  existing integrated spec in this repo now does this (see
  `cypress/e2e/integrated/{legacy,new}/{login,registration}.cy.ts`), so
  match that pattern rather than reasoning it out fresh each time.
- No alias to `cy.wait()` on for calls you didn't stub — synchronize on what
  the UI does instead (a URL change, an element appearing), same as both
  reference specs do.
- If the flow creates or mutates the shared test identity
  (`Cypress.env('testCpf')`, one per machine), call `cy.recyclePlayer()`
  (`commands/api.ts`) in `beforeEach` (with `{ expectClean: true }` if the
  identity must start clean) *and* in `after` — both, not just one; `after`
  alone misses a crashed/interrupted run, and skipping the `beforeEach` check
  turns a previous leaked run into a confusing failure here instead of a loud
  one.
- Live config (GrowthBook flags, which steps a flow actually shows) is not
  fully deterministic — don't hardcode step order/presence the way a mocked
  spec can; re-check the screen after each step and branch on what's actually
  there, the way `registration.cy.ts`'s `runDynamicSteps()` does.

## 5a. Verify against the real thing (mocked) — don't stop at `tsc --noEmit`

A clean typecheck proves the spec compiles, nothing about whether it passes.
Run it for real:

```bash
unset ELECTRON_RUN_AS_NODE   # this harness's sandbox sets it; Cypress's Electron binary needs it unset
CY_MODE=mocked FE_TARGET=pr FE_PR=<PR-number> npx cypress run \
  --spec cypress/e2e/mocked/path/to/spec.cy.ts --browser electron --config video=false
```

`FE_TARGET=pr` (Amplify PR preview) is publicly reachable — no VPN, and
critically no dependence on which branch happens to be checked out or
compiled in a local `gatsby develop` on the runner's machine (a very real
failure mode: a stale/wrong-branch dev server on `localhost:8000` producing
symptoms that look exactly like a test bug). Prefer it over `FE_TARGET=local`
unless the user specifically needs to test against uncommitted local changes.

Read the actual failure, not just pass/fail — a failing screenshot
(`cypress/screenshots/...png`, `Read` it) or the exact assertion diff usually
identifies the real bug (wrong envelope shape, wrong selector, an unrelated
provider's request racing yours) far faster than re-reading source top to
bottom again. Iterate: fix, re-run, repeat until green — twice, since a
flaky third-party consent banner or similar is a known source of one-off
failures in this suite.

## 5b. Verify against the real thing (integrated) — ask before running

`tsc --noEmit` (or, better, `pnpm run typecheck`) is as far as this skill
goes on its own for an integrated spec: running `CY_MODE=integrated`
requires VPN, real `.env` credentials, and a real player identity that gets
recycled/mutated on the shared machine's `FLOW_TEST_CPF` — the same class of
action as any other change to shared state outside this sandbox. Tell the
user the spec is written and typechecked, and ask before actually running it
(`CY_MODE=integrated FE_TARGET=dev npx cypress run --spec
cypress/e2e/integrated/path/to/spec.cy.ts`) — don't run it unprompted the way
step 5a's mocked run is safe to do freely.

## Example transcript (condensed)

> User: "crie testes mocked new para a KIB-8557 aberta no mono-fe"

1. `getJiraIssue(KIB-8557)` → summary is a placeholder scaffold, status Code
   Review → find the real PR: `gh pr list --repo techmobilt/mono-fe --search
   KIB-8557` → PR #2193, branch `KIB-8557`.
2. Read PR body → redesigned RG limits screen, flag
   `fe_registration_loss_limits_enabled`, `GET/POST /limit`,
   `GET /limit/period`.
3. `git fetch origin KIB-8557` in the local mono-fe checkout (on an unrelated
   branch — never touched its working tree), then `git show
   origin/KIB-8557:modules/registration/src/features/activation-flow/activation-limits/activation-limits.tsx`
   and neighboring files → component tree, exact selectors, exact payload
   field names (`period_id`, `duration` in minutes, `source: 'ACTIVATION'`).
4. Traced the entry point two ways: full registration flow (slow, many
   steps) vs. the home lobby's `ActivationCard` for an already-logged-in
   user (fast) → picked the lobby path, added `stubActiveSession`/
   `visitAsLoggedInUser` to `commands.ts`.
5. Wrote the spec, `tsc --noEmit` clean, declared it done.
6. **Actually ran it** (`CY_MODE=mocked FE_TARGET=pr FE_PR=2193 cypress run`)
   → failed. Found and fixed, one real run at a time: an inverted boolean
   default (`active: true` vs. the code's actual `=== false` check), a
   missing `{ data: ... }` response envelope, a class shared by two buttons,
   an unrelated provider's own `POST /limit` call polluting the test's alias,
   and a delayed cookie-consent banner covering the submit button.
7. Green twice in a row → done, with the exact bugs and fixes reported back
   to the user rather than a bare "tests added."

> User: "crie o mesmo teste da KIB-8557 só que integrated"

Steps 1–3 unchanged. Step 4 becomes 4b: file goes to
`cypress/e2e/integrated/new/activation-limits.cy.ts`, no `stub*` calls for
`/limit`/`/limit/period` — those hit the real dev API with the real test
identity. `fe_registration_loss_limits_enabled` pinned on via
`cy.overrideGrowthbookFeature()`, everything else live. `cy.recyclePlayer()`
before/after only if the flow under test actually mutates the shared
identity. Step 5 becomes 5b: typecheck it, then **stop and ask** — "spec's
written and typechecked; want me to actually run it against dev over VPN?" —
rather than firing off a real run against the shared test account on my own.
