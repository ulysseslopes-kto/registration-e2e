/**
 * Copy check for the "Registration 2026" login + account-create flow — not
 * part of the official "Matriz de Testes" (unlike the specs under
 * cypress/e2e/registration/), just a guard against visible-copy regressions.
 * Every expected string below was diffed against apps/core's
 * `src/intl/lang.flat.json` (the source the app's `translate()` reads from)
 * and matched exactly as of 2026-08-28.
 *
 * Kept in its own directory/suite (`pnpm cypress:run:translations`) —
 * separate from `pnpm cypress:run:registration` — since copy here is CMS-
 * driven and changes independently of flow behavior; a wording tweak should
 * only fail this suite, not get mixed in with the behavioral specs.
 *
 * `registerv4.phone.label` ("Telefone") is in that translation table but is
 * never wired into `PhoneStep` — no aria-label or visible label renders it —
 * so it has no DOM assertion here.
 */
describe('Translations — Login landing (loginv4.*, login.reCaptchaShort)', () => {
  it('renders every loginv4 copy string, plus the reCAPTCHA disclosure', () => {
    cy.stubGrowthbookFeatures({
      is_recaptcha_enabled: { defaultValue: true },
    })
    cy.visit('/login/')

    cy.contains('PODE APOSTAR!').should('be.visible')

    cy.get('input[autocomplete="username"]')
      .should('have.attr', 'aria-label', 'Insira seu CPF ou E-mail')
      .and('have.attr', 'placeholder', 'CPF ou E-mail')
    cy.contains('Insira seu CPF ou E-mail').should('be.visible')

    // Reveals the password field so its label/aria-label are actually visible.
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.get('input[autocomplete="current-password"]').should(
      'have.attr',
      'aria-label',
      'Senha',
    )
    cy.contains(/^Senha$/).should('be.visible')

    cy.get('button[type="submit"]').should('have.text', 'Entrar')
    cy.contains(/^ou$/).should('be.visible')
    cy.get('.auth-landing-google-button').should(
      'have.text',
      'Entrar com Google',
    )
    cy.contains('Não tenha uma conta?').should('be.visible')
    cy.get('.auth-landing-register-link').should(
      'have.text',
      'Registre-se agora',
    )
    cy.get('.auth-shell-back-button').should('have.attr', 'aria-label', 'Voltar')
    cy.contains('Protegido por reCAPTCHA.').should('be.visible')
  })
})

describe('Translations — CPF step (registerv4.cpf.*, consent copy, next, support)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.startRegistration()
  })

  it('renders the title, subtitle, "Próximo", and the support aria-label', () => {
    cy.get('h1').should('have.text', 'Insira seu CPF')
    cy.contains(
      'Seu CPF protege sua conta e garante que só você pode jogar',
    ).should('be.visible')
    cy.get('.step-primary-button').should('have.text', 'Próximo')
    cy.get('.auth-shell-support-button').should(
      'have.attr',
      'aria-label',
      'Suporte',
    )
  })

  it('renders the consent copy exactly, including CMS-supplied links as plain text', () => {
    cy.contains(
      'Eu sou maior de 18 anos e aceito os termos e condições, o aviso de privacidade, e a política de cookies. Eu também quero receber apostas grátis, giros grátis e outras promoções exclusivas no meu e-mail.',
    ).should('be.visible')

    // `contain.text`, not `have.text` — the trailing chevron icon carries its
    // own accessible text ("Chevron Down") alongside the translated label.
    cy.get('.cpf-terms-toggle').should('contain.text', 'Ver mais')
    cy.get('.cpf-terms-toggle').click()
    cy.get('.cpf-terms-toggle').should('contain.text', 'Ver menos')

    cy.contains(
      'Eu aceito os Termos e Condições e confirmo que tenho mais de 18 anos.',
    ).should('be.visible')
    cy.contains(
      'Confirmo que li e entendi o Aviso de Privacidade e a Politica de Cookies disponibilizadas neste site, e concordo com o tratamento dos meus dados pessoais conforme descrito.',
    ).should('be.visible')
    cy.contains(
      'Eu gostaria de receber freebets, free spins e outras promoções exclusivas por quaisquer canais de contato.',
    ).should('be.visible')
    cy.contains(
      'Declaro que não pertenço a nenhuma categoria restrita conforme previsto nos Termos e Condições (cláusula 4.1) ou no artigo 26 da Lei 14.790/2023.',
    ).should('be.visible')
  })
})

describe('Translations — Password step (registerv4.password.title/subtitle/checklistTitle)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
  })

  // Rule labels + met/unmet copy are already covered in password.cy.ts.
  it('renders the title, subtitle, and checklist title', () => {
    cy.get('h1').should('have.text', 'Agora uma senha')
    cy.contains(
      'Estamos quase lá! Deixe sua conta mais segura criando uma senha forte',
    ).should('be.visible')
    cy.contains('Sua senha precisa conter:').should('be.visible')
  })
})

describe('Translations — Method step (registerv4.method.*)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
  })

  it('renders the title, subtitle, and both verification-method rows', () => {
    cy.get('h1').should('have.text', 'Método de verificação')
    cy.contains(
      'Vamos deixar sua conta mais segura? Selecione o método de verificação da sua conta',
    ).should('be.visible')

    cy.get('.verification-method-row')
      .eq(0)
      .should('contain.text', 'E-mail')
      .and('contain.text', 'Receba um código no seu e-mail')
    cy.get('.verification-method-row')
      .eq(1)
      .should('contain.text', 'Google')
      .and('contain.text', 'Entre com sua conta Google')
  })
})

describe('Translations — Email step (registerv4.email.title/subtitle/hint)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
  })

  // Error/invalid copy for this step is already covered in email-verification.cy.ts.
  it('renders the title, subtitle, and default hint', () => {
    cy.get('h1').should('have.text', 'Verificação por e-mail')
    cy.contains(
      'Insira seu e-mail para seguirmos com sua verificação de conta. É rápido e vamos adicionar mais uma camada de segurança para você.',
    ).should('be.visible')
    cy.contains('Usaremos esse e-mail para a verificação').should('be.visible')
  })
})

describe('Translations — OTP step (registerv4.otp.title/subtitle/changeEmail/resendQuestion)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@sendToken')
  })

  // "Aguarde {seconds}s" / "Reenviar código" / the error copy are already
  // covered in email-verification.cy.ts.
  it('renders the title, the subtitle with the e-mail interpolated, changeEmail, and resendQuestion', () => {
    cy.get('h1').should('have.text', 'Valide o código')
    cy.contains(
      'Enviamos o seu código de verificação para e2e-test@example.com. Assim que receber, digite a baixo.',
    ).should('be.visible')
    cy.contains('Mudar endereço de e-mail').should('be.visible')
    cy.contains('Não recebeu o código?').should('be.visible')
  })
})

describe('Translations — Phone step (registerv4.phone.title/subtitle)', () => {
  const PHONE_ONLY_ORDER = {
    fe_igp_registration_post_password_step_order: {
      defaultValue: { post_password_phase: [{ step: 'phone', visible: true }] },
    },
  }

  it('renders the title and subtitle', () => {
    cy.stubGrowthbookFeatures(PHONE_ONLY_ORDER)
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()

    cy.get('h1').should('have.text', 'Qual é o seu telefone?')
    cy.contains(
      'Vamos usar seu número para proteger a conta e enviar avisos importantes.',
    ).should('be.visible')
  })
})

describe('Translations — account-create error screen (registerv4.error.title/generic)', () => {
  // Mirrors ORCH-07 (orchestration.cy.ts): a PENDING create that later polls
  // into ERROR only surfaces the flow-level error screen once the flow tries
  // to move past the last step — "Tentar novamente"/"Voltar" are already
  // covered there, this just adds the title/subtitle text.
  it('renders the error title and generic subtitle for a check-failure', () => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_cpf_check_poll_ms: { defaultValue: 50 },
    })
    cy.intercept('POST', '**/registration/cpf-checks/v4', {
      data: { status: 'PENDING', cpfCheckId: 'i18n-error' },
    }).as('cpfCheckCreate')
    cy.intercept('GET', '**/registration/cpf-checks/v4/i18n-error', {
      data: { status: 'ERROR', cpfCheckId: 'i18n-error' },
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

    cy.get('h1').should('have.text', 'Algo deu errado')
    cy.contains('Não foi possível criar sua conta. Tente novamente.').should(
      'be.visible',
    )
  })
})
