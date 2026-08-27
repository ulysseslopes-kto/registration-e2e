/**
 * Mixpanel event tracking for the "Registration 2026" account-create flow
 * (packages/tracking/src/event-tracking-provider.tsx in mono-fe).
 *
 * All tracking in this app is gated behind the `fe_igp_event_tracking_enabled`
 * GrowthBook flag (off in every other spec's fixture, so no event ever fires
 * there) — these tests turn it on explicitly. Mixpanel is initialized with a
 * REAL project token in every environment, including local dev
 * (apps/core/.env.*), so every test here intercepts `**\/track/**` and replies
 * locally instead of letting the request reach the real Mixpanel project.
 *
 * mixpanel-browser batches track() calls instead of sending one request per
 * event: `batch_flush_interval_ms: 5000` (default, unconfigured by this repo)
 * queues events and flushes them together as a single base64-encoded JSON
 * *array* over `navigator.sendBeacon`, on a real (unmocked) 5s timer — `cy.clock()`
 * was tried first and rejected: it freezes every timer on the page, not just
 * Mixpanel's, and left every step's "Próximo" button permanently disabled.
 *
 * `getFlushedEventNames` below waits for real flushes and accumulates event
 * names across them (up to `maxBatches`) until everything expected has shown
 * up. A flush finding nothing new queued sends no request at all (see
 * mixpanel-browser's RequestBatcher.flush — `dataForRequest.length < 1` just
 * reschedules, it doesn't fire), so this only retries while there's a
 * realistic chance more data is still coming — e.g. a longer test chain
 * (CPF → password → method select) can run past the 5s mark, pushing later
 * events into the next flush instead of the first one.
 *
 * `cy.wait(500)` right after `cy.startRegistration()`, before any interaction,
 * gives EventTrackingProvider's `mixpanel.init()` a moment to flip
 * `mixpanelLoaded` — every `trackEvent()` call is a silent no-op until then,
 * including the CPF step's on-mount screen-loaded one. Without this, the CPF
 * step can submit and unmount before that flips, permanently dropping the
 * event. This number is a guess, not measured against a live run — if this
 * spec is still flaky, raise it.
 *
 * CAVEAT: `decodeMixpanelBatch` below is coupled to mixpanel-browser's
 * internal wire format (read from its source, not a documented API) — if a
 * mixpanel-browser upgrade changes it, this is the first thing to check. This
 * hasn't been run against a live browser; if the decode doesn't match what
 * `cypress:open` actually captures, adjust it there.
 *
 * Gap found while writing this (not testable — nothing to assert against):
 * `phone-step.tsx` and `account-create.hook.tsx` (which fires the final
 * `registration/v4` submit and the resulting account creation) never import
 * `useEventTracking` — neither the phone step nor a successful signup fires
 * any Mixpanel event in this flow. Worth flagging to the mono-fe team if
 * that coverage matters for the business.
 */

interface MixpanelEvent {
  event: string
  properties: Record<string, unknown>
}

function decodeMixpanelBatch(body: string): MixpanelEvent[] {
  const raw = new URLSearchParams(body).get('data') ?? body
  let json: string
  try {
    json = atob(raw)
  } catch {
    json = decodeURIComponent(raw)
  }
  const parsed = JSON.parse(json)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/**
 * Waits for real Mixpanel flushes (up to 8s apart) until every event in
 * `expected` has shown up across them, or `maxBatches` flushes have passed.
 */
function getFlushedEventNames(
  expected: string[],
  maxBatches = 2,
): Cypress.Chainable<string[]> {
  const seen: string[] = []
  const attempt = (remaining: number): Cypress.Chainable<string[]> =>
    cy
      .wait('@mixpanelTrack', { timeout: 8000 })
      .its('request.body')
      .then(decodeMixpanelBatch)
      .then((events) => {
        seen.push(...events.map((e) => e.event))
        const stillMissing = expected.some((name) => !seen.includes(name))
        if (!stillMissing || remaining <= 1) return cy.wrap(seen)
        return attempt(remaining - 1)
      })
  return attempt(maxBatches)
}

describe('Mixpanel event tracking — account-create flow', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures({
      fe_igp_event_tracking_enabled: { defaultValue: true },
    })
    cy.stubCpfCheck()
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.intercept('POST', '**/track/**', (req) => {
      req.reply(200)
    }).as('mixpanelTrack')
  })

  it('fires registration_cpf_screen_loaded on mount, then cpf_saved on submit', () => {
    cy.startRegistration()
    cy.wait(500)
    cy.fillCpfStep()
    cy.wait('@cpfCheck')

    const expected = ['registration_cpf_screen_loaded', 'cpf_saved']
    getFlushedEventNames(expected).should('include.members', expected)
  })

  it('fires registration_password_screen_loaded on mount, then password_saved on submit', () => {
    cy.startRegistration()
    cy.wait(500)
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()

    const expected = ['registration_password_screen_loaded', 'password_saved']
    getFlushedEventNames(expected).should('include.members', expected)
  })

  it('fires verification_method_selected and registration_email_input_screen_loaded on selecting e-mail', () => {
    cy.startRegistration()
    cy.wait(500)
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()

    // EVENT_NAMES.VERIFICATION_METHOD_SELECTED literal is 'verfication_method_selected' —
    // that's a typo in packages/tracking/src/constants.ts, not a mistake here.
    const expected = [
      'verfication_method_selected',
      'registration_email_input_screen_loaded',
    ]
    getFlushedEventNames(expected).should('include.members', expected)
  })

  it('fires registration_email_code_verification_screen_loaded after sending the code', () => {
    cy.startRegistration()
    cy.wait(500)
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')

    const expected = ['registration_email_code_verification_screen_loaded']
    getFlushedEventNames(expected).should('include.members', expected)
  })

  it('fires email_code_sent once the OTP is submitted for validation', () => {
    // EVENT_NAMES.EMAIL_CODE_SENT is misleadingly named — it actually fires
    // from validateOtp() once the *entered* code is sent to the backend for
    // validation, not when the verification e-mail itself is sent out.
    cy.stubValidateToken()
    cy.startRegistration()
    cy.wait(500)
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')
    cy.fillOtp()
    cy.wait('@validateToken')

    const expected = ['email_code_sent']
    getFlushedEventNames(expected, 3).should('include.members', expected)
  })
})
