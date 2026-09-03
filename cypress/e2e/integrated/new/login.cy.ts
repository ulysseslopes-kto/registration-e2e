/**
 * Login (auth-landing, "Registration 2026" new login) against the REAL
 * backend — `cypress/e2e/mocked/registration/login/login.cy.ts`'s
 * counterpart for `CY_MODE=integrated` (see cypress.config.ts and
 * cypress/support/commands/api.ts). Only runs when the integrated spec
 * pattern picks it up; `if (Cypress.env('mode') !== 'integrated') return`
 * below is a second, defensive guard in case this file is ever targeted
 * directly with the wrong `CY_MODE`.
 *
 * `POST /auth/login` hits the real API — nothing here is
 * `cy.intercept()`-stubbed for it, and this spec doesn't even use a
 * pass-through `cy.intercept(...).as(...)` on it to key a `cy.wait()`: sync
 * is done by waiting on the URL leaving `/login` instead. GrowthBook features
 * are otherwise REAL here (no `cy.stubGrowthbookFeatures()`) — whatever
 * captcha solution is actually live renders as-is. The one exception is
 * `fe_igp_registration_new_ui_experience`, pinned to `true` via
 * `cy.overrideGrowthbookFeature()` (patches just that key on the real
 * response) so this spec deterministically hits the new auth-landing UI
 * regardless of the flag's live value — `cypress/e2e/integrated/legacy/
 * login.cy.ts` is the counterpart that relies on the real value being
 * `false`. `GET /country/check` is real too (no `cy.stubCountryCheck()`).
 *
 * Unlike `cypress/e2e/integrated/new/registration.cy.ts`, this
 * spec does not create or recycle any account — it logs in with
 * `FLOW_TEST_CPF`/`FLOW_USER_PASSWORD` (.env) as an EXISTING identity, and
 * expects one to already be there. It won't create that account for you:
 * either run the register integrated spec once for this machine's
 * `FLOW_TEST_CPF` without letting its `after()` recycle it afterwards, or
 * point `FLOW_TEST_CPF`/`FLOW_USER_PASSWORD` at a stable seeded test account
 * instead. Running this straight after a full register run (which
 * recycles the identity in its own `after()`) will fail here with invalid
 * credentials — that's expected, not a bug in this spec.
 */
describe('Login (auth-landing) — real backend', () => {
  before(function () {
    if (Cypress.env('mode') !== 'integrated') {
      this.skip()
    }
  })

  it('logs in with the real test identity', () => {
    cy.overrideGrowthbookFeature('fe_igp_registration_new_ui_experience', {
      defaultValue: true,
    })
    cy.acceptCookieBanner()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('input[autocomplete="username"]').type(
      String(Cypress.env('testCpf')),
    )
    cy.get('input[autocomplete="current-password"]').type(
      String(Cypress.env('flowPassword')),
    )
    // AdOpt can re-show the banner with a delay, after the initial
    // post-visit check already ran clean — check again right before this
    // click, which is exactly where it's been seen covering the button.
    cy.dismissCookieBannerIfVisible()
    cy.get('button[type="submit"]').click()

    // No network alias to wait on (see file header) — leaving `/login` is
    // only reachable once the real `doLogin` call succeeds.
    cy.url({ timeout: 30000 }).should('not.include', '/login')
  })
})
