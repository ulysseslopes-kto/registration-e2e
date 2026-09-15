/**
 * Legacy registration's coupon/promo code field
 * (`apps/core/src/atomic-components/organisms/registerContent/steps/emailAndPasswordStep/index.js`)
 * — an always-visible `#couponCode` input gated behind GrowthBook flag
 * `fe_igp_show_coupon_code_on_registration` (off by default, forced on
 * below) and hidden whenever a `?referrerCode=` is present on `/registro/`
 * (`showCouponCode = IS_COUPON_CODE_ENABLED && !hasReferrerCode` — see
 * `refer-a-friend.cy.ts` for the referral-code side of that same flag).
 *
 * Purely optional and unvalidated by the submit button's own disabled state:
 * `validateCoupon` (`apps/core/src/helpers/validators.js`) only checks
 * length (4-8 chars) when non-empty, but `couponCode` isn't in
 * `EmailAndPasswordStep`'s own watched-fields list
 * (`formSubmitIsDisabled(fieldsToWatch, ...)`), so an invalid length shows
 * its error message without blocking `#nextBtn1`.
 *
 * On submit it becomes the `registration/v4` payload's `affiliateMarker`
 * (`getRegisterModel`, `registerModel.js`:
 * `getValues('couponCode')?.slice(0, 50)`) — same field name the new flow's
 * CPF-step coupon field sends (KIB-9237,
 * cypress/e2e/mocked/new/registration/coupon-code.cy.ts), though that one
 * omits the property entirely when empty rather than sending `''`.
 */
import { DEFAULT_FLOW } from '../../../../support/fixtures'

describe('Legacy registration — coupon code', () => {
  const FLOW_WITH_COUPON_CODE = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
    registration_new_flow: { defaultValue: true },
    fe_social_sign_in_enabled: { defaultValue: true },
    player_registration_national_id_check: { defaultValue: true },
    igp_registration_verification_phases: { defaultValue: DEFAULT_FLOW },
    fe_igp_show_coupon_code_on_registration: { defaultValue: true },
  }

  /** Clicks past RegisterLobby (forced on by `fe_social_sign_in_enabled`) into EmailAndPasswordStep. */
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

  describe('field visibility', () => {
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

  describe('reaches the registration payload as affiliateMarker', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(FLOW_WITH_COUPON_CODE)
      cy.stubLegacyCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
      cy.stubLegacySmsSend()
      cy.stubLegacySmsValidate()
      cy.stubRegister()
      cy.stubLogin() // loginUser() downstream calls, after a successful registration/v4
      cy.acceptCookieBanner()
      cy.visit('/registro/')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      selectEmailRegistration()
    })

    it('a valid coupon code is sent as affiliateMarker on the final registration payload', () => {
      fillEmailAndPasswordStep()
      cy.get('#couponCode').type('E2ECODE')
      cy.get('#nextBtn1').click()
      cy.wait('@emailCheck')
      cy.wait('@legacyCpfCheck')
      cy.wait('@sendToken')
      cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
      completeEmailVerificationStep()
      completePhoneVerificationStep()
      completeAddressStepAndSubmit()
      cy.wait('@register')
        .its('request.body')
        .should('have.property', 'affiliateMarker', 'E2ECODE')
    })

    it('no coupon code typed sends an empty affiliateMarker', () => {
      completeEmailAndPasswordStep()
      completeEmailVerificationStep()
      completePhoneVerificationStep()
      completeAddressStepAndSubmit()
      cy.wait('@register')
        .its('request.body')
        .should('have.property', 'affiliateMarker', '')
    })
  })

  describe('coupon format validation (validateCoupon, helpers/validators.js)', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(FLOW_WITH_COUPON_CODE)
      cy.acceptCookieBanner()
      cy.visit('/registro/')
      cy.dismissCookieBannerIfVisible()
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      selectEmailRegistration()
    })

    it('a coupon code outside 4-8 characters shows the format error without disabling #nextBtn1', () => {
      fillEmailAndPasswordStep()
      cy.get('#nextBtn1').should('not.be.disabled')

      // `mode: 'onBlur'` (registerContent/index.js's useForm) — validation
      // only (re)runs once the field loses focus.
      cy.get('#couponCode').type('AB').blur()
      cy.contains(
        'O código promocional deve ter entre 4 e 8 caracteres.',
      ).should('be.visible')
      cy.get('#nextBtn1').should('not.be.disabled')

      cy.get('#couponCode').clear().type('E2ECODE').blur()
      cy.contains(
        'O código promocional deve ter entre 4 e 8 caracteres.',
      ).should('not.exist')
    })
  })
})
