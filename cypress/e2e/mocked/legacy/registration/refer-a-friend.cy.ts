/**
 * Legacy registration's "refer a friend" handling
 * (`apps/core/src/atomic-components/organisms/registerContent`) — a
 * `?referrerCode=` query param on `/registro/` is read directly by
 * `RegisterContent` (`index.js` line ~59, `useQueryParams()`) and carried
 * into the final `POST /registration/v4` payload as `referralToken`
 * (`getRegisterModel`, `apps/core/src/utils/formModelGetters/registerModel.js`
 * line ~116: `referralToken: friendReferrerCode?.replace('/', '')`). The
 * `.replace('/', '')` exists because the dedicated `/refer-a-friend` landing
 * page bakes a trailing slash into the value before redirecting into
 * `/registro/` (`apps/core/src/templates/referAFriend/index.js`) — covered
 * here directly on `/registro/` with a URL-encoded trailing slash rather
 * than by following that redirect (its real route slug varies by locale/env
 * and isn't worth pinning down for this).
 *
 * This is purely a query-param → payload-field pipe: there's no dedicated
 * referral-code input, and no FE validation call for the code (unlike the
 * coupon-code flow, which has one) — an invalid/expired code is a backend
 * concern the FE never surfaces distinctly, per `getRegistrationErrorMessage`
 * (`registerContent/index.js`) having no messageCode branch for it. Also not
 * covered here: the `attributions[]` array's own `{ type: 'referral' }` entry
 * (`registerModel.js` line ~123) — that one is sourced from a cookie set by
 * `setAttributionCookieFromParams` on Gatsby's `onRouteUpdate`
 * (`packages/utils/src/attributionCookie.ts`, `gatsby-browser.js`), which is
 * an SPA-navigation hook not reliably exercised by a single `cy.visit()`.
 *
 * `hasReferrerCode` (`new URLSearchParams(...).has('referrerCode')` — a
 * presence check, not a validity one) has exactly two other observable
 * effects, both gated behind GrowthBook flags that default to off:
 * - `EmailAndPasswordStep` hides `#couponCode` whenever a referral code is
 *   present (`showCouponCode = IS_COUPON_CODE_ENABLED && !hasReferrerCode`,
 *   flag `fe_igp_show_coupon_code_on_registration`) — with the flag at its
 *   real default (off), the field never renders either way, so asserting
 *   "hidden" is only meaningful with the flag forced on (done locally, per
 *   describe, below).
 * - `RegisterLobby` shows a referral-specific welcome title instead of the
 *   default one (`register.lobby.referAFriendTitle` = "Você foi indicado por
 *   um amigo" vs. `register.lobby.title` = "Bem-vindo à KTO") — but that
 *   step only renders at all behind `fe_social_sign_in_enabled`
 *   (`useRegistrationSteps.js`). Unlike the coupon flag, this one is forced
 *   on in the shared `LEGACY_FLOW` below rather than per-describe, so
 *   `RegisterLobby` (Google sign-in button, "Registrar com o E-mail" button)
 *   is every test's first screen here — `selectEmailRegistration()` clicks
 *   past it into `EmailAndPasswordStep` wherever a test needs the actual
 *   form fields.
 */
import { DEFAULT_FLOW } from '../../../../support/fixtures'

describe('Legacy registration — refer a friend', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
    registration_new_flow: { defaultValue: true },
    fe_social_sign_in_enabled: { defaultValue: true },
    player_registration_national_id_check: { defaultValue: true },
    igp_registration_verification_phases: { defaultValue: DEFAULT_FLOW },
  }

  /** Clicks past RegisterLobby (forced on by `fe_social_sign_in_enabled` in LEGACY_FLOW) into EmailAndPasswordStep. */
  const selectEmailRegistration = () => {
    cy.contains('Registrar com o E-mail').click()
  }

  const fillEmailAndPasswordStep = () => {
    cy.get('#national_id').type('529.982.247-25')
    cy.get('#email').type('e2e-test@example.com')
    cy.get('#mobileNumber').type('11987654321')
    cy.get('#password').type('Sup3rSecret!23')
    cy.get('#nationality').select('Brasileira')
    cy.get('#tandc').check({ force: true })
    cy.get('#privacyPolicy').check({ force: true })
    cy.get('#belongHere').check({ force: true })
  }

  /** Assumes stubEmailCheck/stubLegacyCpfCheck/stubSendToken are already set up. */
  const completeEmailAndPasswordStep = () => {
    fillEmailAndPasswordStep()
    cy.get('#nextBtn1').click()
    cy.wait('@emailCheck')
    cy.wait('@legacyCpfCheck')
    cy.wait('@sendToken')
    cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
  }

  /** Assumes stubValidateToken/stubLegacySmsSend are already set up. */
  const completeEmailVerificationStep = (code = '1234') => {
    cy.get('#otp-input').type(code)
    cy.wait('@validateToken')
    cy.wait('@legacySmsSend')
    cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
  }

  /** Assumes stubLegacySmsValidate is already set up. */
  const completePhoneVerificationStep = (code = '1234') => {
    cy.get('#otp-input').type(code)
    cy.wait('@legacySmsValidate')
    cy.get('#cep', { timeout: 10000 }).should('be.visible')
  }

  /** Completes the address step and submits, up to (not including) waiting on `@register`. */
  const completeAddressStepAndSubmit = () => {
    // Av. Paulista, São Paulo/SP — a stable, well-known real CEP (see
    // registration.cy.ts's header for why this isn't hand-rolled).
    cy.get('#cep').type('01310-100')
    cy.get('#addressNumber').type('1000')
    cy.get('#nextBtn1').should('have.text', 'Registre-se').click()
  }

  describe('referral code carried into the registration payload', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(LEGACY_FLOW)
      cy.stubLegacyCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
      cy.stubLegacySmsSend()
      cy.stubLegacySmsValidate()
      cy.stubRegister()
      cy.stubLogin() // loginUser() downstream calls, after a successful registration/v4
      cy.acceptCookieBanner()
    })

    it.only('a ?referrerCode on the register URL is sent as registration/v4\'s referralToken', () => {
      cy.visit('/registro/?referrerCode=E2E-FRIEND-CODE')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      cy.contains('Você foi indicado por um amigo').should('be.visible')
      selectEmailRegistration()
      completeEmailAndPasswordStep()
      completeEmailVerificationStep()
      completePhoneVerificationStep()
      completeAddressStepAndSubmit()
      cy.wait('@register')
        .its('request.body')
        .should('have.property', 'referralToken', 'E2E-FRIEND-CODE')
    })

    it('a trailing slash on the code (as the refer-a-friend landing page appends) is stripped before submission', () => {
      cy.visit('/registro/?referrerCode=E2E-FRIEND-CODE%2F')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      selectEmailRegistration()
      completeEmailAndPasswordStep()
      completeEmailVerificationStep()
      completePhoneVerificationStep()
      completeAddressStepAndSubmit()
      cy.wait('@register')
        .its('request.body')
        .should('have.property', 'referralToken', 'E2E-FRIEND-CODE')
    })

    it('no referrerCode in the URL sends no referralToken', () => {
      cy.visit('/registro/')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      selectEmailRegistration()
      completeEmailAndPasswordStep()
      completeEmailVerificationStep()
      completePhoneVerificationStep()
      completeAddressStepAndSubmit()
      cy.wait('@register')
        .its('request.body')
        .should('not.have.property', 'referralToken')
    })
  })

  describe('coupon code field is hidden when a referral code is present', () => {
    const FLOW_WITH_COUPON_CODE = {
      ...LEGACY_FLOW,
      fe_igp_show_coupon_code_on_registration: { defaultValue: true },
    }

    beforeEach(() => {
      cy.stubGrowthbookFeatures(FLOW_WITH_COUPON_CODE)
      cy.acceptCookieBanner()
    })

    it('renders the coupon field when there is no referral code', () => {
      cy.visit('/registro/')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      selectEmailRegistration()
      cy.get('#couponCode').should('be.visible')
    })

    it('hides the coupon field when a referral code is present', () => {
      cy.visit('/registro/?referrerCode=E2E-FRIEND-CODE')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      selectEmailRegistration()
      cy.get('#couponCode').should('not.exist')
    })
  })

  describe('register-lobby welcome banner', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(LEGACY_FLOW)
      cy.acceptCookieBanner()
    })

    it('shows the referral welcome message when a referral code is present', () => {
      cy.visit('/registro/?referrerCode=E2E-FRIEND-CODE')
      cy.dismissCookieBannerIfVisible()
      cy.contains('Você foi indicado por um amigo').should('be.visible')
      cy.contains('Bem-vindo à KTO').should('not.exist')
    })

    it('shows the default welcome message otherwise', () => {
      cy.visit('/registro/')
      cy.dismissCookieBannerIfVisible()
      cy.contains('Bem-vindo à KTO').should('be.visible')
      cy.contains('Você foi indicado por um amigo').should('not.exist')
    })
  })
})
