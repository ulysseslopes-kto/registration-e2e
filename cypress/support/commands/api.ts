/**
 * Backend-facing commands for the integrated suite — the Cypress counterpart of
 * the Bruno flows in `player-service/http/bruno-flows` and
 * `auth-service/http/bruno-flows` (KIB-8187 / KIB-8448).
 *
 * Everything here runs through `cy.request`, i.e. in Cypress's Node process:
 * no CORS, no browser sandbox, so it can reach the internal gateway the UI
 * cannot. The split is deliberate:
 *
 *   browser (UI)  ->  api.kto-dev.com            the real journey under test
 *   cy.request    ->  boapi.kto-dev.com/player   setup/teardown (VPN required)
 *
 * None of these are used by the mocked suite, and none are safe outside
 * dev/stg — `cypress.config.ts` refuses to start an integrated run whose
 * `internalApi` is not an allow-listed dev/stg gateway, mirroring the
 * backend's own fail-closed guard (`TestSupportGuard`).
 */

const publicApi = () => String(Cypress.env('apiUrl'))
/** The internal gateway rewrites `/player/**` onto the service root. */
const testSupport = () =>
  `${String(Cypress.env('internalApi'))}/player/test-support`
const supportKey = () => String(Cypress.env('testSupportKey'))
const testCpf = () => String(Cypress.env('testCpf'))

interface RecycleReport {
  nationalId: string
  playerId: number | null
  userRecycled: boolean
  preRegistrationDeleted: boolean
}

/**
 * Recycles the test identity so the next run can reuse the same CPF —
 * `DELETE /test-support/players/{nationalId}` (TEST-ONLY, dev/stg only).
 *
 * The backend tombstones `national_id`/`email`/`username`/`mobile_number` with
 * values derived from the player id, closes the account, deletes the Keycloak
 * user and removes a leftover pre-registration
 * (`TestSupportPlayerRecycleService`). It answers 200 even with nothing to
 * recycle, so calling it defensively is free.
 *
 * Call it BOTH in `beforeEach` and in `after`: Mocha's `after` does not run
 * when the browser crashes or the run is interrupted, and the Bruno flows get
 * away with a single trailing `99-cleanup` only because their runner is
 * strictly linear.
 *
 * `expectClean` makes the pre-flight case loud: if there was in fact something
 * to recycle at the *start* of a spec, a previous run died mid-way. The run
 * self-heals and continues — but swallowing that silently is how a leaked
 * player turns into a confusing failure three steps later.
 */
Cypress.Commands.add(
  'recyclePlayer',
  (
    nationalId: string = testCpf(),
    { expectClean = false }: { expectClean?: boolean } = {},
  ) =>
    cy
      .request({
        method: 'DELETE',
        url: `${testSupport()}/players/${nationalId}`,
        headers: { 'X-Test-Support-Key': supportKey() },
        // A failed cleanup must never turn a passing test red — that would
        // hide the actual result — but it must never be silent either.
        failOnStatusCode: false,
      })
      .then((response) => {
        const report =
          response.status === 200
            ? ((response.body?.data ?? null) as RecycleReport | null)
            : null

        if (report === null) {
          Cypress.log({
            name: 'recycle',
            message:
              `FAILED (${response.status}) — the identity may have been left ` +
              `dirty for the next run. Check VPN, X-Test-Support-Key, and ` +
              `whether the test-support layer is live on this environment.`,
          })
        } else if (
          expectClean &&
          (report.userRecycled || report.preRegistrationDeleted)
        ) {
          Cypress.log({
            name: 'recycle',
            message:
              `identity was DIRTY on entering the spec ` +
              `(userRecycled=${report.userRecycled}, ` +
              `preRegistrationDeleted=${report.preRegistrationDeleted}) — a ` +
              `previous run died before cleaning up. Cleaned, carrying on.`,
          })
        }

        // `cy.wrap`, not a bare `return report`: a `.then` callback returning
        // null/undefined makes Cypress yield the PREVIOUS subject (the raw
        // response) instead of null, so the caller would silently get the
        // wrong thing on the failure path.
        return cy.wrap<RecycleReport | null>(report, { log: false })
      }),
)

/**
 * Marks the flow e-mail as verified on the pre-registration —
 * `POST /registration/email/mark-verified`, on the **public** gateway (that
 * route is exposed there, so this one needs no VPN).
 *
 * This is the only automatable way past e-mail verification: the real
 * `send-token`/`validate-token` pair delivers a 4-digit code to a mailbox
 * nothing here can read, and `/registration/v4` rejects a pre-registration
 * without a verified e-mail ("Email cannot be null" — pinned by guard 02 of
 * `flow-1n-registration-guards`). Hiding the step in the UI with
 * `visible: false` does not help; the backend requirement stays.
 *
 * Body is snake_case: both igp-be's and player-service's DTOs for this
 * endpoint use `national_id`/`language_code`
 * (`RegistrationEmailVerificationMarkVerifiedRequest`) — note the Bruno
 * request's doc block claims player-service is camelCase, which does not hold
 * for this endpoint.
 */
Cypress.Commands.add(
  'markEmailVerified',
  (email: string, nationalId: string = testCpf()) =>
    cy.request({
      method: 'POST',
      url: `${publicApi()}/registration/email/mark-verified`,
      headers: { 'x-kto-automation': 'true' },
      body: {
        email,
        national_id: nationalId,
        language_code: 'pt-br',
      },
    }),
)

/**
 * A fresh identity for one run: the CPF is fixed (it has to be valid in the
 * anti-fraud provider's sandbox, and the recycle above is what frees it),
 * while e-mail and mobile are epoch-derived so two runs never collide on the
 * unique columns. Same scheme as the Bruno flows' `01-cpf-check` pre-request
 * script.
 *
 * The e-mail domain must be listed in the backend's
 * `registration.test-user-domains` for the player to be born `TEST_USER`.
 */
Cypress.Commands.add('freshIdentity', () => {
  const epoch = Date.now()
  return cy.wrap(
    {
      cpf: testCpf(),
      email: `flow.${epoch}@${String(Cypress.env('testEmailDomain'))}`,
      mobile: `119${String(epoch).slice(-8)}`,
      password: String(Cypress.env('flowPassword')),
    },
    { log: false },
  )
})

/** Seeds a judicial exclusion. Every seed MUST be cleared in the same spec. */
Cypress.Commands.add(
  'seedJudicialExclusion',
  (nationalId: string = testCpf()) =>
    cy.request({
      method: 'POST',
      url: `${testSupport()}/judicially-excluded/${nationalId}`,
      headers: { 'X-Test-Support-Key': supportKey() },
    }),
)

Cypress.Commands.add(
  'clearJudicialExclusion',
  (nationalId: string = testCpf()) =>
    cy.request({
      method: 'DELETE',
      url: `${testSupport()}/judicially-excluded/${nationalId}`,
      headers: { 'X-Test-Support-Key': supportKey() },
      failOnStatusCode: false,
    }),
)

/**
 * Blacklists an e-mail pattern. Keep the pattern surgical enough that it can
 * only ever match this suite's own addresses — the Bruno flow uses a fake
 * domain (`flow.*@blacklist-flow.invalid`) precisely so no real dev traffic is
 * caught by it. Returns the row id, which is needed to remove it.
 */
Cypress.Commands.add('seedBlacklistEmail', (emailPattern: string) =>
  cy
    .request({
      method: 'POST',
      url: `${testSupport()}/blacklist-emails`,
      headers: { 'X-Test-Support-Key': supportKey() },
      body: { emailPattern },
    })
    .then((response) => response.body?.data?.id as number),
)

Cypress.Commands.add('clearBlacklistEmail', (id: number) =>
  cy.request({
    method: 'DELETE',
    url: `${testSupport()}/blacklist-emails/${id}`,
    headers: { 'X-Test-Support-Key': supportKey() },
    failOnStatusCode: false,
  }),
)

/**
 * Bounded retry for state the platform only reaches asynchronously — the
 * Cypress equivalent of the Bruno flows' `bru.setNextRequest` self-loops. The
 * KYC player, for instance, is created by a Kafka consumer reacting to
 * `PlayerRegisteredEvent`, so there is nothing to wait on synchronously.
 *
 * `predicate` must resolve truthy for success; the timeout message names what
 * was being waited on, so it reads as a diagnosis instead of a bare assertion
 * failure.
 */
Cypress.Commands.add(
  'pollUntil',
  (
    description: string,
    predicate: () => Cypress.Chainable<boolean>,
    {
      attempts = 10,
      waitMs = 3000,
    }: { attempts?: number; waitMs?: number } = {},
  ) => {
    // Every branch yields the same chainable type on purpose: returning a bare
    // value (or nothing) from a `.then` would make Cypress pass the previous
    // subject along, and the recursion would then be chaining off a boolean.
    const attempt = (remaining: number): Cypress.Chainable<null> =>
      predicate().then((ok) => {
        if (ok) return cy.wrap(null, { log: false })
        if (remaining <= 1) {
          throw new Error(
            `[pollUntil] "${description}" did not happen within ${attempts} ` +
              `attempts x ${waitMs}ms.`,
          )
        }
        return cy
          .wait(waitMs, { log: false })
          .then(() => attempt(remaining - 1))
      })
    return attempt(attempts)
  },
)

declare global {
  namespace Cypress {
    interface Chainable {
      /** See implementation doc above. Integrated suite only. */
      recyclePlayer(
        nationalId?: string,
        options?: { expectClean?: boolean },
      ): Chainable<RecycleReport | null>
      /** See implementation doc above. Integrated suite only. */
      markEmailVerified(
        email: string,
        nationalId?: string,
      ): Chainable<Cypress.Response<unknown>>
      /** See implementation doc above. Integrated suite only. */
      freshIdentity(): Chainable<{
        cpf: string
        email: string
        mobile: string
        password: string
      }>
      /** See implementation doc above. Integrated suite only. */
      seedJudicialExclusion(
        nationalId?: string,
      ): Chainable<Cypress.Response<unknown>>
      /** See implementation doc above. Integrated suite only. */
      clearJudicialExclusion(
        nationalId?: string,
      ): Chainable<Cypress.Response<unknown>>
      /** See implementation doc above. Integrated suite only. */
      seedBlacklistEmail(emailPattern: string): Chainable<number>
      /** See implementation doc above. Integrated suite only. */
      clearBlacklistEmail(id: number): Chainable<Cypress.Response<unknown>>
      /** See implementation doc above. */
      pollUntil(
        description: string,
        predicate: () => Chainable<boolean>,
        options?: { attempts?: number; waitMs?: number },
      ): Chainable<null>
    }
  }
}

export {}
