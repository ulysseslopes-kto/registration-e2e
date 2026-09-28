/**
 * Legacy "Esqueceu a senha?" flow, reached from `LoginContent`'s
 * `#forgotPassword` link (apps/core/src/templates/onBoarding/login.js) to a
 * *separate route*, `/forgot-password/` (apps/core/src/templates/onBoarding/forgot-password.js,
 * created at `/forgot-password/` in apps/core/src/create/onBoarding.js). Not
 * gated by any GrowthBook flag itself — both the legacy and the new login's
 * "forgot password" link land on this exact same component tree, only the
 * login page they start from differs. Every test below still starts at
 * `/login/` and clicks `#forgotPassword`, rather than visiting
 * `/forgot-password/` directly, to stay closer to the real user flow —
 * `fe_igp_registration_new_ui_experience: false` is there for that reason,
 * to render the legacy login form the link starts from.
 *
 * `forgot-password.js` drives a state machine (`PASSWORD_RECOVERY_STEPS`,
 * apps/core/src/utils/constants.js): choose a verification channel (email or
 * SMS) → send a code → verify the code → **mandatory, unconditional KYC
 * liveness** → set a new password. Unlike `account-reopen.cy.ts`'s
 * `AccountReOpen` modal, there is no `postMessage`-based bypass visible for
 * this flow's `KycSteps` widget, so these tests stop at asserting the
 * liveness start screen appears (`data-qa="kyc-button-start"`,
 * `resetPassword.verificationStartTitle`) rather than trying to drive
 * through a real third-party liveness provider.
 *
 * The actual "type a new password and see it applied" assertion isn't here —
 * it's not reachable from this flow without a real KYC provider. It's
 * covered instead in the sibling spec `reset-password.cy.ts`, against
 * `/reset/?token=...`, a genuinely different (token-link, not
 * `#forgotPassword`) entry point that happens to skip its own liveness step
 * by default — see that file's header comment.
 */
describe('Legacy login — forgot password entry point', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  it('"Esqueceu a senha?" navigates from /login/ to the verification-method screen', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#forgotPassword').click()

    cy.url().should('include', '/forgot-password')
    cy.contains('Escolha sua primeira etapa de verificação').should(
      'be.visible',
    )
    cy.contains('E-mail').should('be.visible')
    cy.contains('SMS').should('be.visible')
  })
})

describe('Forgot password — email verification flow', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  const openEmailFlow = () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()
    cy.get('#forgotPassword').click()
    cy.dismissCookieBannerIfVisible()
    cy.contains('E-mail').click()
    cy.contains('Verificação de e-mail').should('be.visible')
  }

  it('a valid email sends the code, then a verified OTP starts the mandatory liveness check', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()

    cy.get('#email').type('e2e-test@example.com')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendEmailCode')

    // Not asserted: `forgotPassword.emailSentSuccess` ("Um e-mail de
    // redefinição foi enviado") — `isSuccess` and `isVerificationCodeStep`
    // (emailFlow.js) are the exact same boolean, and that success `Message`
    // only renders `condition={!isVerificationCodeStep}` — so it can never
    // actually appear; a real, pre-existing dead-code bug, not a scope cut.
    cy.contains('Código de verificação enviado!').should('be.visible')

    cy.stubForgotPasswordValidateEmailCode()
    cy.stubForgotPasswordLiveness()
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')
    cy.wait('@forgotPasswordLiveness')

    cy.contains('Última etapa da verificação').should('be.visible')
    cy.get('[data-qa="kyc-button-start"]').should('be.visible')
  })

  it('messageCode 70 shows "email not linked to an account", no OTP step', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 70 })

    cy.get('#email').type('nobody@example.com')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.get('#errorMessage')
      .should('be.visible')
      .and('contain.text', 'Este e-mail não está vinculado a uma conta.')
    cy.contains('Código de verificação enviado!').should('not.exist')
  })

  it('messageCode 420 shows the recaptcha-failure error', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 420 })

    cy.get('#email').type('e2e-test@example.com')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.get('#errorMessage')
      .should('be.visible')
      .and('contain.text', 'A validação do recaptcha falhou')
  })

  // `forgotPassword.email.channelNotAvailable` is missing from
  // apps/core/src/intl/lang.flat.json — real prod behavior, not a test-env
  // quirk (see `translate`'s fallback-key behavior, TranslationProvider.tsx).
  // Asserting on the current fallback text so a future addition of the real
  // translation is a visible, deliberate diff to this spec.
  it('messageCode 729 shows the (untranslated fallback) channel-not-available error', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 729 })

    cy.get('#email').type('e2e-test@example.com')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.get('#errorMessage')
      .should('be.visible')
      .and('contain.text', 'forgotPassword/email/channelNotAvailable')
  })

  it('an invalid OTP shows the generic wrong-code toast and stays on the OTP step', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.get('#email').type('e2e-test@example.com')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.stubForgotPasswordValidateEmailCode({ statusCode: 400, messageCode: 401 })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')

    cy.contains('Código inválido. Confira e tente novamente.').should(
      'be.visible',
    )
    cy.contains('Código de verificação enviado!').should('be.visible')
  })

  // `twoFa.email.tooManyRequests` is ALSO missing from lang.flat.json — same
  // fallback-key caveat as messageCode 729 above.
  it('messageCode 604 shows the (untranslated fallback) too-many-requests toast', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.get('#email').type('e2e-test@example.com')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.stubForgotPasswordValidateEmailCode({ statusCode: 429, messageCode: 604 })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')

    cy.contains('twoFa/email/tooManyRequests').should('be.visible')
  })
})

describe('Forgot password — SMS verification flow', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  const openSmsFlow = () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()
    cy.get('#forgotPassword').click()
    cy.dismissCookieBannerIfVisible()
    cy.contains('SMS').click()
    cy.contains('Verificação de SMS').should('be.visible')
  }

  it('a valid phone number sends the code, then a verified OTP starts the mandatory liveness check', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode()

    cy.get('#mobileNumber').type('11987654321')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendSmsCode')

    // Not asserted: `forgotPassword.smsSentSuccess` ("Código enviado com
    // sucesso!") — same dead-code condition as the email flow's
    // `emailSentSuccess` (see that test's comment): `isSuccess` and
    // `isVerificationCodeStep` are identical in smsFlow.js too, so this
    // `Message` can never render either.
    cy.contains('Código de verificação enviado!').should('be.visible')

    cy.stubForgotPasswordValidateSmsCode()
    cy.stubForgotPasswordLiveness()
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateSmsCode')
    cy.wait('@forgotPasswordLiveness')

    cy.contains('Última etapa da verificação').should('be.visible')
    cy.get('[data-qa="kyc-button-start"]').should('be.visible')
  })

  // Same missing-translation caveat as the email flow's own 729 case —
  // `forgotPassword.sms.channelNotAvailable` isn't in lang.flat.json either.
  it('messageCode 729 shows the (untranslated fallback) channel-not-available error', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode({ statusCode: 400, messageCode: 729 })

    cy.get('#mobileNumber').type('11987654321')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.get('#errorMessage')
      .should('be.visible')
      .and('contain.text', 'forgotPassword/sms/channelNotAvailable')
  })

  it('an invalid OTP shows the generic wrong-code toast', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode()
    cy.get('#mobileNumber').type('11987654321')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.stubForgotPasswordValidateSmsCode({ statusCode: 400, messageCode: 401 })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateSmsCode')

    cy.contains('Código inválido. Confira e tente novamente.').should(
      'be.visible',
    )
  })

  // Unlike the email flow's own 604 case, `twoFa.sms.tooManyRequests` IS
  // present in lang.flat.json — real translated text, no fallback caveat.
  it('messageCode 604 shows the real too-many-requests toast', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode()
    cy.get('#mobileNumber').type('11987654321')
    cy.get('#btnResetPassword').click()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.stubForgotPasswordValidateSmsCode({ statusCode: 429, messageCode: 604 })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateSmsCode')

    cy.contains(
      'Muitas tentativas. Aguarde alguns minutos antes de pedir um novo código.',
    ).should('be.visible')
  })
})
