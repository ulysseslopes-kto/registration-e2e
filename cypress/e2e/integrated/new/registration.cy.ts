/**
 * Full smoke run of the "Registration 2026" account-create flow (KIB-8932)
 * against the REAL backend — `cypress/e2e/mocked/new/registration/account-create.cy.ts`'s
 * counterpart for `CY_MODE=integrated` (see cypress.config.ts and
 * cypress/support/commands/api.ts). Only runs when the integrated spec
 * pattern picks it up; `if (Cypress.env('mode') !== 'integrated') return`
 * below is a second, defensive guard in case this file is ever targeted
 * directly with the wrong `CY_MODE`.
 *
 * What's real and what isn't:
 * - CPF check, e-mail check, `send-token`, and the final `registration/v4`
 *   submit all hit the real API (`Cypress.env('apiUrl')`) — none of them are
 *   `cy.intercept()`-stubbed, and this spec doesn't even use a pass-through
 *   `cy.intercept(...).as(...)` on them to key a `cy.wait()`: sync is done by
 *   waiting on what the UI does in response instead.
 * - `validate-token` is the one deliberate exception (`cy.stubValidateToken()`
 *   below) — its real counterpart only ever succeeds for the actual 4-digit
 *   code `send-token` mailed to a real inbox nothing in CI can read, and
 *   `goNext()` past the e-mail step (email-verification-step.hook.tsx's
 *   `validateOtp`) only fires on that call succeeding. Stubbing it is what
 *   lets `cy.fillOtp()`'s made-up code actually advance the UI.
 * - Stubbing the client's belief that the code was valid does not make it
 *   true on the backend: `/registration/v4` independently rejects a
 *   pre-registration with an unverified e-mail, so `cy.markEmailVerified()`
 *   satisfies that server-side requirement for real, directly against the
 *   API (see its doc comment in commands/api.ts) — the two calls cover the
 *   client-side and server-side halves of "e-mail verified" separately.
 *   It's called *before* `cy.fillOtp()`, not after — see the comment at its
 *   call site below for why doing it any later races the client's own
 *   automatic `registration/v4` submit.
 * - GrowthBook features are otherwise REAL here (no
 *   `cy.stubGrowthbookFeatures()`), and so is `GET /country/check` (no
 *   `cy.stubCountryCheck()`) — whichever steps
 *   `igp_registration_verification_phases` has live are candidates, and
 *   `fe_igp_registration_post_password_step_order`'s live `post_password_phase`
 *   decides both which of them actually render and in what order
 *   (`useAccountCreate`'s `steps` memo, account-create.hook.tsx) — e-mail
 *   before phone is not guaranteed. `runDynamicSteps()` below re-checks the
 *   screen after handling each dynamic step and keeps going until neither is
 *   showing anymore, so it follows whichever order/subset the live flag
 *   actually produces instead of assuming e-mail always comes first (the
 *   assumption that originally hung this spec on a `.verification-method-row`
 *   that had already been passed, or never rendered at all, depending on the
 *   environment). The one flag pinned regardless is
 *   `fe_igp_registration_new_ui_experience`, via `cy.overrideGrowthbookFeature()`
 *   (patches just that key on the real response) so this spec deterministically
 *   hits the new account-create UI regardless of its live value —
 *   `cypress/e2e/integrated/legacy/registration.cy.ts` is the counterpart that
 *   relies on the real value being `false`.
 *
 * The phone step itself is a single plain field with no OTP involved
 * (phone-step.tsx), and the real CPF check for this test identity reports
 * `mobilePrefixAndNumberRequired: true` — the account-create hook requires a
 * mobile number before submitting whenever that's true, so
 * `cy.fillPhoneStep()` runs whenever the step actually renders (a
 * per-identity result, not a given).
 *
 * Net effect: CPF step → password step → e-mail and/or phone step, in
 * whatever order/subset the live config produces (real send-token, faked
 * validate-token for e-mail) → final submit, all real except that one
 * client-side OTP check. The asserted "net effect" here is the happy path
 * this identity currently exercises, not a guarantee.
 *
 * `cy.recyclePlayer()` runs before *and* after each test — the test CPF
 * (`Cypress.env('testCpf')`, one per machine) has to be free of any account
 * before a real `registration/v4` will accept it again.
 */
describe('Account create — full flow (integrated backend)', () => {
  before(function () {
    if (Cypress.env('mode') !== 'integrated') {
      this.skip()
    }
  })

  beforeEach(() => {
    cy.recyclePlayer(undefined, { expectClean: true })
  })

  after(() => {
    cy.recyclePlayer()
  })

  it('creates an account end to end against the real backend', () => {
    // The one deliberate intercept in this spec — see the file header.
    cy.stubValidateToken()
    cy.overrideGrowthbookFeature('fe_igp_registration_new_ui_experience', {
      defaultValue: true,
    })
    cy.startRegistration()

    cy.freshIdentity().then((identity) => {
      cy.fillCpfStep(identity.cpf)

      // No network alias to wait on (see file header) — the password step's
      // field only renders once the CPF step's own submit handler
      // (cpf-step.tsx's runCpfCheckAndAdvance) gets an 'accepted' outcome
      // back from the real POST, so waiting for it here is equivalent to
      // waiting on the request itself. A rejected/errored CPF check leaves
      // the CPF step on screen instead, which fails this with a clear
      // "never found" timeout rather than a silent hang.
      cy.get('input[type="password"]', { timeout: 30000 }).should(
        'be.visible',
      )

      // AdOpt can re-show the banner with a delay, after the initial
      // post-visit check already ran clean — check again right before this
      // click, which is exactly where it's been seen covering the button.
      cy.dismissCookieBannerIfVisible()
      cy.fillPasswordStep(identity.password)

      // `fe_igp_registration_post_password_step_order`'s live `post_password_phase`
      // decides whether e-mail or phone renders first (`useAccountCreate`'s
      // `steps` memo, account-create.hook.tsx) — this spec doesn't assume
      // either order. `runDynamicSteps` re-checks the screen after handling
      // each one and keeps going until neither is showing anymore, so it
      // follows whichever order the live flag actually produces.
      const runDynamicSteps = (attemptsLeft = 3) => {
        if (attemptsLeft <= 0) return
        // Both step transitions this checks for are purely client-side (no
        // network round trip to lean on for settling, unlike the CPF/OTP
        // transitions elsewhere in this spec), so retry until whichever
        // comes next has rendered instead of taking one racy snapshot right
        // after the previous step's click.
        cy.get('body', { timeout: 15000 }).should(($body) => {
          const hasEmailStep =
            $body.find('.verification-method-row').length > 0
          const hasPhoneStep = $body.find('input[inputmode="tel"]').length > 0
          const isSubmitting = $body.text().includes('Criando sua conta')
          expect(hasEmailStep || hasPhoneStep || isSubmitting).to.be.true
        })

        cy.get('body').then(($body) => {
          // Only renders when the live config includes `email_verification`
          // — see the file header.
          if ($body.find('.verification-method-row').length) {
            cy.dismissCookieBannerIfVisible()
            cy.selectEmailVerificationMethod()
            cy.fillEmailStep(identity.email)
            // Marked server-side *before* the OTP is even typed, not after
            // `cy.wait('@validateToken')`: once the stubbed validate-token
            // response lands, the client's own `goNext()` can fire
            // `registration/v4` immediately and fully asynchronously (e.g.
            // whenever e-mail turns out to be the last dynamic step) — a
            // Cypress command queued "after" that wait can still lose the
            // race to the app's own real submit call. Doing it first removes
            // the race instead of trying to win it: by the time OTP typing
            // even starts, the backend already considers this e-mail
            // verified, so no order of dynamic steps afterward can submit
            // before it.
            cy.markEmailVerified(identity.email, identity.cpf)
            // Real send-token round trip — slower than any stubbed response.
            cy.fillOtp()
            // Any 4-digit code passes — validate-token is stubbed (file
            // header), so this never reaches the real endpoint; it only
            // exists to let the client believe the code was valid and
            // advance, which cy.markEmailVerified() above already made true
            // server-side too.
            cy.wait('@validateToken', { timeout: 30000 })
            runDynamicSteps(attemptsLeft - 1)
            return
          }

          // Only renders when the CPF check above flagged
          // `mobilePrefixAndNumberRequired` — see the file header.
          if ($body.find('input[inputmode="tel"]').length) {
            cy.dismissCookieBannerIfVisible()
            cy.fillPhoneStep(identity.mobile)
            runDynamicSteps(attemptsLeft - 1)
          }

          // Neither is showing — either already past both, or a step never
          // renders at all, either way there's nothing left to do here.
        })
      }
      runDynamicSteps()

      // Final submit is deferred internally (account-create.hook.tsx) until
      // the CPF check's async result lands, so the real `registration/v4`
      // call can fire well after the last step's click — this is the only
      // signal we wait on for it, real anti-fraud latency included.
      cy.contains('Criando sua conta', { timeout: 30000 }).should('be.visible')
    })
  })
})
