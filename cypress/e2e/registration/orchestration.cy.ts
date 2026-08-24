/**
 * Flow orchestration & feature flags (test matrix section 06, ORCH-01..08).
 * ORCH-05 (SSO always skips e-mail verification) is skipped — reaching the
 * flow with `verifiedEmail` set requires either a real Google OAuth exchange
 * or React Router history *state* set by `navigate(path, { state })`, neither
 * of which Cypress can reproduce via a plain `cy.visit()`; see
 * apps/e2e/README.md.
 */
describe('Account create — orchestration & feature flags', () => {
  it('ORCH-01: default order (flag absent) is e-mail verification, then phone', () => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_post_password_step_order: null,
    })
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.get('.verification-method-row').should('have.length', 2)
    cy.get('input[inputmode="tel"]').should('not.exist')
  })

  it('ORCH-02: the flag can flip the order to phone, then e-mail verification', () => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_post_password_step_order: {
        defaultValue: {
          post_password_phase: [
            { step: 'phone', visible: true },
            { step: 'email_verification', visible: true },
          ],
        },
      },
    })
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.get('input[inputmode="tel"]').should('be.visible')
    cy.get('.verification-method-row').should('not.exist')
  })

  it('ORCH-03: `visible: false` removes e-mail verification even though the CPF/phone are normal', () => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_post_password_step_order: {
        defaultValue: {
          post_password_phase: [
            { step: 'email_verification', visible: false },
          ],
        },
      },
    })
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: false })
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    // No post-password step left at all — password was the last step.
    cy.contains('Validando seus dados').should('be.visible')
  })

  it('ORCH-04: mobileRequired=false removes phone even though it is in the flag order', () => {
    cy.stubGrowthbookFeatures() // default order: email_verification, then phone
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: false })
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.stubValidateToken()
    cy.stubRegister()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@sendToken')
    cy.fillOtp()
    cy.wait('@validateToken')
    // Straight to the final submit — no phone step in between.
    cy.contains('Validando seus dados').should('be.visible')
  })

  // ORCH-05 skipped — see file header.

  it('ORCH-06: a REJECTED CPF check is terminal — only "Voltar", no retry', () => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_cpf_check_poll_ms: { defaultValue: 50 },
    })
    cy.intercept('POST', '**/registration/cpf-checks/v4', {
      data: { status: 'PENDING', cpfCheckId: 'orch-06' },
    }).as('cpfCheckCreate')
    cy.intercept('GET', '**/registration/cpf-checks/v4/orch-06', {
      data: { status: 'REJECTED', cpfCheckId: 'orch-06' },
    }).as('cpfCheckPoll')
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheckCreate')
    cy.wait('@cpfCheckPoll')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.fillEmailStep()
    cy.wait('@sendToken')
    cy.stubValidateToken()
    cy.fillOtp()
    cy.contains('button', 'Voltar').should('be.visible')
    cy.contains('button', 'Tentar novamente').should('not.exist')
  })

  it('ORCH-07: a check-failure (not rejection) allows retry, back to the CPF step', () => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_cpf_check_poll_ms: { defaultValue: 50 },
    })
    cy.intercept('POST', '**/registration/cpf-checks/v4', {
      data: { status: 'PENDING', cpfCheckId: 'orch-07' },
    }).as('cpfCheckCreate')
    // A 500 here would work too, but the poll only gives up after
    // MAX_CPF_CHECK_POLLS (100) failed attempts — a real terminal `ERROR`
    // status is the faster way to exercise this same "not REJECTED" path.
    cy.intercept('GET', '**/registration/cpf-checks/v4/orch-07', {
      data: { status: 'ERROR', cpfCheckId: 'orch-07' },
    }).as('cpfCheckPoll')
    cy.startRegistration()
    cy.fillCpfStep('52998224725')
    cy.wait('@cpfCheckCreate')
    cy.wait('@cpfCheckPoll')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.fillEmailStep()
    cy.wait('@sendToken')
    cy.stubValidateToken()
    cy.fillOtp()

    cy.contains('button', 'Tentar novamente').click()
    // Back on the CPF step, value preserved.
    cy.get('input[inputmode="numeric"]').should(
      'have.value',
      '529.982.247-25',
    )
  })

  it('ORCH-08: Turnstile — advancing before the token arrives resolves on its own', () => {
    cy.stubGrowthbookFeatures({
      captcha_registration_solution: { defaultValue: 'TURNSTILE' },
      fe_igp_registration_post_password_step_order: {
        defaultValue: { post_password_phase: [] },
      },
    })
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: false })
    cy.stubRegister()
    cy.acceptCookieBanner()
    cy.visit('/registro/', {
      onBeforeLoad(win) {
        // Fakes the Cloudflare Turnstile SDK: `render` schedules the
        // verified callback after a delay, mimicking the real widget
        // resolving after the user has already tried to advance.
        interface FakeTurnstileWindow extends Window {
          turnstile?: {
            render: (
              el: unknown,
              options: { callback: (token: string) => void },
            ) => string
            remove: (widgetId: string) => void
          }
        }
        ;(win as FakeTurnstileWindow).turnstile = {
          render: (_el, options) => {
            win.setTimeout(() => options.callback('e2e-fake-token'), 800)
            return 'e2e-widget'
          },
          remove: () => {},
        }
      },
    })
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    // Password is now the last step (post-password order emptied above);
    // its "Próximo" fires the final submit, which waits on the Turnstile
    // token instead of hanging or requiring a second click.
    cy.contains('Validando seus dados').should('be.visible')
    cy.wait('@register')
  })
})
