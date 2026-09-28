/**
 * "Registration 2026" forgot-password flow —
 * `modules/registration/src/features/forgot-password/` (`ForgotPassword`,
 * `useForgotPassword`), mounted via `ForgotPasswordRoute.js`
 * (apps/core/src/atomic-components/organisms/registration2026/ForgotPasswordRoute.js).
 *
 * Same page/route as the legacy flow (`/forgot-password/`), NOT a separate
 * URL: `apps/core/src/templates/onBoarding/forgot-password.js` branches on
 * `fe_igp_registration_new_ui_experience` at the template level — `true`
 * (the base fixture's own default, so no override needed here) renders this
 * component tree, `false` renders the legacy one covered by
 * `cypress/e2e/mocked/legacy/login/forgot-password.cy.ts`.
 *
 * Reached from `auth-landing.tsx`'s "Esqueceu a senha?" button, only
 * interactable once a valid CPF/e-mail is typed into the identifier field
 * (`identifierValid` reveals the password area it lives in) — same
 * `input[autocomplete="username"]` field `login.cy.ts` already types into.
 * Typing a CPF (not an e-mail) keeps `initialEmail` unset, so the flow
 * starts at the method-choice step rather than skipping straight to
 * `contact` — the more complete path to exercise here.
 *
 * View order (`forgot-password.consts.ts`): `method → contact → otp →
 * identity → password`. "identity" is NOT a document/CPF check — it's this
 * flow's renamed KYC/liveness step (`forgot-password-identity.hook.tsx`).
 * Unlike the legacy flow's `KycSteps` (which needs a real third-party
 * widget's `postMessage`, so those specs stop at "liveness screen
 * appeared"), this step's "verified" signal is a plain polled GET
 * (`stubKycLivenessStatus`, see its doc comment in `commands.ts`) — the
 * *first* poll is awaited before any interval starts, so a mocked
 * `status: 'APPROVED'` response resolves it synchronously. That's what lets
 * the happy-path test below drive an actual password change to completion,
 * something no legacy spec can do from `#forgotPassword` alone.
 *
 * Copy comes from `@repo/translation`'s own CMS-backed pipeline (not the
 * legacy `apps/core` one `lang.flat.json` also serves) — the `forgotpasswordv4.*`
 * keys are, unlike legacy's, nearly all present, except
 * `forgotpasswordv4.contact.tooManyRequests` (messageCode 604 on the contact
 * step), which still renders the raw fallback key.
 */
describe('New login (auth-landing) — forgot password entry point', () => {
  it('"Esqueceu a senha?" (after a valid identifier) navigates to the method-choice screen', () => {
    cy.stubGrowthbookFeatures()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.dismissCookieBannerIfVisible()
    cy.contains('button', 'Esqueceu a senha?').click()

    cy.url().should('include', '/forgot-password')
    cy.contains('Escolha o método de verificação').should('be.visible')
    cy.contains('E-mail').should('be.visible')
    cy.contains('SMS').should('be.visible')
  })
})

describe('Forgot password (new) — email verification flow', () => {
  const openEmailFlow = () => {
    cy.stubGrowthbookFeatures()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.dismissCookieBannerIfVisible()
    cy.contains('button', 'Esqueceu a senha?').click()
    // Scoped to `.verification-method-row` — bare `cy.contains('E-mail')`
    // can match the row's own description text ("Receba um código no seu
    // e-mail"), not just its title.
    cy.contains('.verification-method-row', 'E-mail').click()
    cy.contains('Verificação por e-mail').should('be.visible')
  }

  it('a full round trip — send code, verify OTP, pass KYC, set a new password — completes and returns to login', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.contains('Valide o código').should('be.visible')
    cy.stubForgotPasswordValidateEmailCode()
    cy.stubForgotPasswordLiveness({ type: 'LIVENESS' })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')
    cy.wait('@forgotPasswordLiveness')

    cy.contains('Verifique sua identidade').should('be.visible')
    cy.stubKycLivenessStatus({ status: 'APPROVED' })
    cy.contains('button', 'Começar verificação').click()
    cy.wait('@kycLivenessStatus')

    cy.contains('Redefina sua senha').should('be.visible')
    cy.stubForgotPasswordResetV2()
    cy.get('input[aria-label="Senha"]')
      .type('NewSup3rSecret!23')
      .should('have.value', 'NewSup3rSecret!23')
    cy.get('input[aria-label="Confirme sua senha"]')
      .type('NewSup3rSecret!23')
      .should('have.value', 'NewSup3rSecret!23')
    cy.contains('button', 'Salvar nova senha').click()
    cy.wait('@forgotPasswordResetV2')

    cy.url({ timeout: 10000 }).should('include', '/login')
  })

  it('messageCode 70 shows "no account found for this e-mail"', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 70 })

    cy.get('input[type="email"]').type('nobody@example.com')
    cy.get('.step-primary-button').click()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.contains('Não encontramos uma conta com esse e-mail.').should(
      'be.visible',
    )
    cy.contains('Valide o código').should('not.exist')
  })

  it('messageCode 729 shows "channel not available"', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 729 })
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.contains(
      'Esse canal de verificação não está disponível para sua conta.',
    ).should('be.visible')
  })

  // `forgotpasswordv4.contact.tooManyRequests` is missing from the CMS
  // translations — real current behavior, not a test-env quirk (see this
  // file's header comment and `formatKey`, packages/translation/src/utils).
  it('messageCode 604 shows the (untranslated fallback) too-many-requests error', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 604 })
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.contains('forgotpasswordv4/contact/tooManyRequests').should(
      'be.visible',
    )
  })

  it('any other messageCode falls back to the generic "could not send code" error', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode({ statusCode: 400, messageCode: 999 })
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.contains('Não foi possível enviar o código. Tente novamente.').should(
      'be.visible',
    )
  })

  it('an invalid OTP shows the generic error — no messageCode branching on this step', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    // Any non-ok response renders the same generic text, regardless of
    // messageCode (`validateOtp`, forgot-password.hook.tsx, doesn't branch
    // like legacy's OTP steps do) — 604 here would look identical to a
    // plain wrong code.
    cy.stubForgotPasswordValidateEmailCode({ statusCode: 400, messageCode: 604 })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')

    cy.contains('Código inválido').should('be.visible')
  })

  it('a rejected identity check shows the retry screen, and retrying re-requests liveness', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.stubForgotPasswordValidateEmailCode()
    cy.stubForgotPasswordLiveness({ type: 'LIVENESS' })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')
    cy.wait('@forgotPasswordLiveness')

    cy.stubKycLivenessStatus({ status: 'REJECTED' })
    cy.contains('button', 'Começar verificação').click()
    cy.wait('@kycLivenessStatus')

    cy.contains(
      'Não foi possível confirmar sua identidade. Tente novamente.',
    ).should('be.visible')
    cy.contains('button', 'Tentar novamente').should('be.visible')

    // `retryVerification` re-fetches a fresh liveness session with the same
    // stored token/userId before re-entering capture — assert that re-call,
    // not just the button's presence.
    cy.stubForgotPasswordLiveness({ type: 'LIVENESS' })
    cy.contains('button', 'Tentar novamente').click()
    cy.wait('@forgotPasswordLiveness')
  })

  it('a failed final password save shows the generic error, no redirect', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.stubForgotPasswordValidateEmailCode()
    cy.stubForgotPasswordLiveness({ type: 'LIVENESS' })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')
    cy.wait('@forgotPasswordLiveness')

    cy.stubKycLivenessStatus({ status: 'APPROVED' })
    cy.contains('button', 'Começar verificação').click()
    cy.wait('@kycLivenessStatus')

    cy.stubForgotPasswordResetV2({ statusCode: 400, messageCode: 32 })
    cy.get('input[aria-label="Senha"]').type('NewSup3rSecret!23')
    cy.get('input[aria-label="Confirme sua senha"]').type('NewSup3rSecret!23')
    cy.contains('button', 'Salvar nova senha').click()
    cy.wait('@forgotPasswordResetV2')

    cy.contains(
      'Não foi possível salvar sua nova senha. Tente novamente.',
    ).should('be.visible')
    cy.url().should('include', '/forgot-password')
  })

  it('mismatched passwords keep the submit button disabled, no network call', () => {
    openEmailFlow()
    cy.stubForgotPasswordSendEmailCode()
    cy.fillEmailStep()
    cy.wait('@forgotPasswordSendEmailCode')

    cy.stubForgotPasswordValidateEmailCode()
    cy.stubForgotPasswordLiveness({ type: 'LIVENESS' })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateEmailCode')
    cy.wait('@forgotPasswordLiveness')

    cy.stubKycLivenessStatus({ status: 'APPROVED' })
    cy.contains('button', 'Começar verificação').click()
    cy.wait('@kycLivenessStatus')

    cy.intercept('POST', '**/player/password/forgot').as('forgotPasswordResetV2')
    cy.get('input[aria-label="Senha"]').type('NewSup3rSecret!23')
    cy.get('input[aria-label="Confirme sua senha"]').type('SomethingElse!23')
    cy.contains('button', 'Salvar nova senha').should('be.disabled')

    cy.get('@forgotPasswordResetV2.all').should('have.length', 0)
  })
})

describe('Forgot password (new) — SMS verification flow', () => {
  const openSmsFlow = () => {
    cy.stubGrowthbookFeatures()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.dismissCookieBannerIfVisible()
    cy.contains('button', 'Esqueceu a senha?').click()
    cy.contains('.verification-method-row', 'SMS').click()
    cy.contains('Verificação por telefone').should('be.visible')
  }

  it('a valid phone number sends the code, then a verified OTP requests liveness', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode()
    cy.fillPhoneStep()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.contains('Valide o código').should('be.visible')
    cy.stubForgotPasswordValidateSmsCode()
    cy.stubForgotPasswordLiveness({ type: 'LIVENESS' })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateSmsCode')
    cy.wait('@forgotPasswordLiveness')

    cy.contains('Verifique sua identidade').should('be.visible')
  })

  // Same copy as the email channel's own 70 case — `CONTACT_ERROR_MESSAGE_KEY`
  // (contact-step.tsx) has no separate SMS "invalid" key, so this
  // e-mail-specific text renders on the SMS channel too. A real, pre-existing
  // copy inconsistency, not a scope cut.
  it('messageCode 70 shows the (e-mail-worded) "no account found" error', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode({ statusCode: 400, messageCode: 70 })
    cy.fillPhoneStep()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.contains('Não encontramos uma conta com esse e-mail.').should(
      'be.visible',
    )
  })

  it('messageCode 729 shows "channel not available"', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode({ statusCode: 400, messageCode: 729 })
    cy.fillPhoneStep()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.contains(
      'Esse canal de verificação não está disponível para sua conta.',
    ).should('be.visible')
  })

  it('an invalid OTP shows the generic error', () => {
    openSmsFlow()
    cy.stubForgotPasswordSendSmsCode()
    cy.fillPhoneStep()
    cy.wait('@forgotPasswordSendSmsCode')

    cy.stubForgotPasswordValidateSmsCode({ statusCode: 400, messageCode: 604 })
    cy.fillOtp()
    cy.wait('@forgotPasswordValidateSmsCode')

    cy.contains('Código inválido').should('be.visible')
  })
})
