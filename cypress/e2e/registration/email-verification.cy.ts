/**
 * E-mail verification step of the account-create flow (test matrix section
 * 03, EMAIL-01..10). EMAIL-09/10 (Google SSO within this step) are skipped —
 * Cypress cannot drive the real Google OAuth popup `useGoogleLogin` opens;
 * see apps/e2e/README.md.
 * Every test here runs at the suite's default viewport (iPhone X); EMAIL-03
 * also runs once at a desktop viewport, to catch layout/interaction
 * regressions specific to larger screens.
 */
describe('Account create — e-mail verification step', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    // Now on the "method" sub-view.
  })

  it('EMAIL-01: selecting "e-mail" reveals the field; "Próximo" needs a valid format', () => {
    cy.selectEmailVerificationMethod()
    cy.get('input[type="email"]').should('be.visible')
    cy.get('.step-primary-button').should('be.disabled')
    cy.get('input[type="email"]').type('e2e-test@example.com')
    cy.get('.step-primary-button').should('not.be.disabled')
  })

  it('EMAIL-02: no error while empty; format error once content is invalid', () => {
    cy.selectEmailVerificationMethod()
    cy.contains('E-mail inválido').should('not.exist')
    cy.get('input[type="email"]').type('lucas@')
    cy.contains('E-mail inválido. Verifique o endereço digitado.').should(
      'be.visible',
    )
  })

  it('EMAIL-03: sending the code advances to the OTP screen with a 30s resend cooldown', () => {
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')
    cy.get('input[data-input-otp="true"]').should('be.visible')
    cy.contains('Aguarde 30s').should('be.visible')
  })

  it('EMAIL-03 (desktop): sending the code advances to the OTP screen on a desktop viewport', () => {
    cy.viewport(1000, 660)
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')
    cy.get('input[data-input-otp="true"]').should('be.visible')
    cy.contains('Aguarde 30s').should('be.visible')
  })

  it('EMAIL-04: a 4-digit code submits automatically, no button needed', () => {
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.stubValidateToken()
    cy.stubRegister()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@sendToken')
    cy.fillOtp()
    cy.wait('@validateToken')
    // Advances past e-mail verification onto the password-confirmed flow's
    // next stage (no further post-password step configured in the fixture),
    // i.e. straight to the final registration submit.
    cy.contains('Validando seus dados').should('be.visible')
  })

  it('EMAIL-05: editing a failed code re-arms auto-submit', () => {
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.stubRegister()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@sendToken')

    cy.stubValidateToken({ statusCode: 400 })
    cy.fillOtp('1111')
    cy.wait('@validateToken')
    cy.contains('Código inválido. Verifique e tente novamente.').should(
      'be.visible',
    )

    cy.stubValidateToken()
    cy.get('input[data-input-otp="true"]').type('{backspace}2')
    cy.wait('@validateToken')
    cy.contains('Validando seus dados').should('be.visible')
  })

  it('EMAIL-06: resend stays disabled until the countdown reaches zero', () => {
    cy.stubEmailCheck()
    cy.stubSendToken()
    // Installed before the countdown's `setInterval` is created (right after
    // submitEmail resolves) — cy.clock() only takes over timers created
    // after it's installed, so it has to be in place before this point.
    cy.clock()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@sendToken')

    cy.contains('button', 'Reenviar código').should('not.exist')
    cy.contains('Aguarde 30s').should('be.visible')

    cy.tick(30000)
    cy.contains('button', 'Reenviar código').should('be.visible')
  })

  it('EMAIL-07: a "+" alias e-mail shows the alias-specific message', () => {
    cy.stubEmailCheck({ valid: false, status: 'ALIAS_NOT_ALLOWED' })
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep('usuario+teste@gmail.com')
    cy.wait('@emailCheck')
    cy.contains(
      'Não aceitamos e-mails com o caractere "+". Remova essa parte do endereço ou use outro e-mail.',
    ).should('be.visible')
  })

  it('EMAIL-08: an e-mail blocked for another reason shows the generic message', () => {
    cy.stubEmailCheck({ valid: false })
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.contains(
      'Não foi possível continuar com este e-mail. Verifique se digitou corretamente ou tente outro.',
    ).should('be.visible')
  })

  // EMAIL-09/10 — Google SSO from this step's "method" sub-view — skipped:
  // `useGoogleLogin` opens a real Google OAuth popup Cypress cannot drive.
})
