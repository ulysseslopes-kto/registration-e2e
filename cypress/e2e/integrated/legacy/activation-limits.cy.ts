/**
 * Legacy RG (responsible-gaming) limits screen (`RGLimits`) against the REAL
 * backend — `cypress/e2e/mocked/legacy/activation/limits.cy.ts`'s
 * counterpart for `CY_MODE=integrated`. Only runs when the integrated spec
 * pattern picks it up; `if (Cypress.env('mode') !== 'integrated') this.skip()`
 * below is a second, defensive guard in case this file is ever targeted
 * directly with the wrong `CY_MODE`.
 *
 * Basic scope on purpose: one happy-path test, the simplest single-click
 * "Usar os limites máximos" path — real `POST /limit` calls, no manual-entry
 * drawer interaction. The drawer/dropdown UI already has real timing quirks
 * covered in the mocked suite's own header (`limitPeriods` loading after the
 * choice-stage title renders); layering that on top of a real backend's own
 * latency isn't worth it for a first integrated pass at this screen.
 *
 * Unlike the mocked suite, there's no `cy.visitAsLoggedInUser()` shortcut
 * here — `isLoggedIn` has to come from a real session, and
 * `PostLoginVerificationModal`'s `ELIGIBILITY[MODAL_IDS.RG]`
 * (`packages/user-verification-flow/src/eligibility.ts`) specifically
 * requires `user.user_status.name === 'PENDING'` and no existing
 * `STOP_LOSS`/`GAMING_SESSION` limit — exactly the state a freshly
 * registered account is already in. So this spec drives the same real
 * legacy registration `cypress/e2e/integrated/legacy/registration.cy.ts`
 * does (same two unavoidable OTP stubs, same real CPF/e-mail/phone/CEP
 * calls, same `cy.markEmailVerified()` for the server-side half of e-mail
 * verification) and lets the post-login flow surface the RG screen on its
 * own, the same way a real user hits it.
 *
 * GrowthBook is real here except three pinned flags
 * (`cy.overrideGrowthbookFeature()`, patches each key on top of the live
 * response — see that command's own doc for why calling it more than once
 * accumulates instead of the second call shadowing the first):
 * `fe_igp_registration_new_ui_experience: false` (this screen only exists
 * behind the legacy UI — `Layout`'s `HIDE_BLOCKING_ACTIVATION_MODAL`
 * suppresses it whenever the new-flow UI is on), `fe_registration_loss_limits_enabled: true`
 * (the master switch; checked three times across
 * `eligibility.ts`/`RgStep.jsx`/`useRequiredRGLimits.js` — if the live
 * default is off, this screen never appears at all, which is specifically
 * what this spec exists to exercise), and `captcha_registration_solution:
 * 'NONE'` (keeps the real Cloudflare Turnstile widget from ever loading on
 * the registration form this spec has to drive through first — see the
 * inline comment at its call site for why intercepting the challenge
 * network call itself isn't the right fix here).
 * `igp_registration_verification_phases` is deliberately NOT pinned — same
 * as `registration.cy.ts`'s own header: whatever the live
 * `activation_phase` actually contains decides whether `rg` is reachable at
 * all (`usePostLoginModalResolver`'s `buildOrderFromActivationPhase`). If
 * this spec fails because the RG choice screen never shows, that's a real
 * signal about the live config, not a bug in the spec.
 *
 * No network alias to `cy.wait()` on anywhere (nothing is intercepted apart
 * from the two OTP stubs) — every step below synchronizes on what the UI
 * does in response, same convention as every other integrated spec in this
 * repo.
 *
 * `cy.recyclePlayer()` runs before *and* after — the test CPF
 * (`Cypress.env('testCpf')`, one per machine) has to be free of any account
 * before a real `registration/v4` will accept it again.
 *
 * `RegisterLobby` (Google sign-in / "Registrar com o E-mail" choice) may or
 * may not be the very first screen on `/registro/`, depending on the live
 * `fe_social_sign_in_enabled` flag — on for this target as of writing. This
 * spec detects and clicks past it rather than assuming either way, since
 * that's exactly the kind of live-config drift `registration.cy.ts`'s own
 * header already warns about for its other flags.
 */
describe('Legacy RG limits screen — real backend (integrated)', () => {
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

  it('a freshly registered account is prompted for RG limits, and "Usar os limites máximos" submits for real', () => {
    cy.overrideGrowthbookFeature('fe_igp_registration_new_ui_experience', {
      defaultValue: false,
    })
    cy.overrideGrowthbookFeature('fe_registration_loss_limits_enabled', {
      defaultValue: true,
    })
    // `useTurnstileOn` (apps/core/src/hooks/useTurnstile.js) only renders the
    // Cloudflare Turnstile widget — and only loads its script at all — when
    // this flag is exactly `'TURNSTILE'`; pinning it to `'NONE'` (the mocked
    // suite's own fixture value) is what keeps `challenges.cloudflare.com`
    // out of this run entirely, rather than trying to intercept/fake a real
    // Cloudflare challenge response, which wouldn't fire the widget's own JS
    // callback the form's submit gating (`isCaptchaPassed`) waits on anyway.
    cy.overrideGrowthbookFeature('captcha_registration_solution', {
      defaultValue: 'NONE',
    })

    // The two deliberate intercepts in this spec — see the file header.
    cy.stubValidateToken()
    cy.stubLegacySmsValidate()
    cy.acceptCookieBanner()
    cy.visit('/registro/')
    cy.dismissCookieBannerIfVisible()
    cy.get('#register-form', { timeout: 10000 }).should('exist')

    // Whether `RegisterLobby` (Google/E-mail choice) is the first screen
    // here depends on the live `fe_social_sign_in_enabled` flag — on for
    // this target as of writing, off in the mocked suite's fixture (which
    // is why the mocked counterpart never needs this). Click past it when
    // it's there; a no-op wait+no-click when it isn't, since this repo has
    // no stable selector for that lobby screen to gate on directly.
    cy.get('body').then(($body) => {
      if ($body.find('#national_id').length === 0) {
        cy.contains('Registrar com o E-mail').click()
      }
    })

    cy.freshIdentity().then((identity) => {
      cy.get('#national_id').type(identity.cpf)
      cy.get('#email').type(identity.email)
      cy.get('#mobileNumber').type(identity.mobile)
      cy.get('#password').type(identity.password)
      cy.get('#tandc').check({ force: true })
      cy.get('#privacyPolicy').check({ force: true })
      cy.get('#belongHere').check({ force: true })
      cy.dismissCookieBannerIfVisible()
      cy.get('#nextBtn1').click()

      // No network alias to wait on (see file header) — the real CPF check
      // (polled until terminal) and e-mail check both gate this "Próximo",
      // and the e-mail step's OTP input only renders once both clear.
      cy.get('#otp-input', { timeout: 30000 }).should('be.visible')
      // Any 4-digit code passes — validate-token is stubbed (file header).
      cy.get('#otp-input').type('1234')
      // Real server-side verification — see the file header for why this is
      // still needed even though validate-token's client-side check above is
      // faked.
      cy.markEmailVerified(identity.email, identity.cpf)

      // PhoneVerificationStep sends its real SMS automatically on mount —
      // wait for its (freshly re-mounted, same #otp-input id) input before
      // typing into it.
      cy.get('#otp-input', { timeout: 30000 }).should('be.visible')
      // Any 4-digit code passes — check-verification-sms-code is stubbed
      // (file header).
      cy.get('#otp-input').type('1234')

      // Av. Paulista, São Paulo/SP — a stable, well-known real CEP; its
      // address/state/city autofill is a real backend call.
      cy.get('#cep', { timeout: 30000 }).should('be.visible')
      cy.get('#cep').type('01310-100')
      cy.get('#addressNumber').type('1000')
      cy.dismissCookieBannerIfVisible()
      cy.get('#nextBtn1').should('have.text', 'Registre-se').click()

      // Final submit + auto-login are deferred behind the real
      // `registration/v4` call; success redirects away from `/registro` —
      // the only signal waited on for it, same as registration.cy.ts.
      cy.url({ timeout: 30000 }).should('not.include', '/registro')

      // Now logged in on the destination page — `PostLoginVerificationModal`
      // (mounted globally by `Layout`) resolves eligibility asynchronously
      // and should surface the RG choice screen on its own, no navigation or
      // click needed to open it.
      cy.dismissCookieBannerIfVisible()
      cy.contains('Escolha como definir seus limites', {
        timeout: 30000,
      }).should('be.visible')

      cy.dismissCookieBannerIfVisible()
      cy.get('#max-limit-set-card').click()

      // No network alias to wait on (real backend) — the choice screen
      // disappearing (replaced by whatever verification step comes next, or
      // the modal closing entirely) is the signal both real `POST /limit`
      // calls succeeded. What comes after is out of scope here, same as the
      // mocked suite's own choice not to chase it.
      cy.contains('Escolha como definir seus limites', {
        timeout: 30000,
      }).should('not.exist')
    })
  })
})
