/**
 * Legacy RG (responsible-gaming) limits screen — `RGLimits`
 * (`apps/core/src/atomic-components/organisms/RGLimits/index.js`), the
 * pre-KIB-8557 screen the "Registration 2026" redesign
 * (`cypress/e2e/mocked/new/activation/limits.cy.ts`) replaces for the new
 * flow only. KIB-8557 never touched this component — it's the counterpart
 * still live whenever `fe_igp_registration_new_ui_experience` is off.
 *
 * Trigger mechanism is completely different from the new flow's lobby-card
 * shortcut: this screen isn't behind a click at all. `Layout`
 * (`organisms/layout/index.js`, mounted on every page including the home
 * lobby) always renders `PostLoginVerificationModal`, and
 * `usePostLoginModalResolver`'s `ELIGIBILITY[MODAL_IDS.RG]`
 * (`packages/user-verification-flow/src/eligibility.ts`) opens it
 * automatically for any logged-in, non-mobile-app user whose
 * `user_status.name === 'PENDING'` and who doesn't already have both a
 * `STOP_LOSS` and a `GAMING_SESSION` limit — checked via its own `GET
 * /limit` call, independent of the one `RGLimits` itself makes on mount.
 * `cy.visitAsLoggedInUser()` (same command the new-flow spec uses) already
 * seeds `isLoggedIn` correctly; this suite only adds `user_status: { name:
 * 'PENDING' }` to the seeded user.
 *
 * `HIDE_BLOCKING_ACTIVATION_MODAL` (`layout/index.js`) suppresses this
 * screen entirely whenever `fe_igp_registration_new_ui_experience` is on
 * (the shared fixture's default) — the flag has to be forced off here, the
 * opposite of every `new`-flow spec.
 *
 * `igp_registration_verification_phases` is deliberately NOT overridden:
 * the shared fixture's value doesn't survive
 * `packages/user-verification-flow/src/parser.ts`'s exclusivity check
 * (`phone_verification` present in neither phase) and silently falls back
 * to `DEFAULT_FLOW`, whose `activation_phase` already includes `rg` — so
 * the fixture as-is already produces a reachable `rg` step without any
 * extra setup.
 *
 * Same four endpoints as the new flow (`GET /limit`, `GET /limit/period`,
 * `POST /limit`, `PUT /limit/{id}`, all `hasNestedData: false`) — this
 * suite reuses `stubLimitPeriods`/`stubSetLimit`/`stubActiveSession`
 * unmodified. The payload shape differs in exactly one way: this legacy
 * component's `amount`/`duration`/`period_id`/`type` fields carry no
 * `source` field at all (the new flow's `source: 'ACTIVATION'` is new in
 * KIB-8557, not something being ported from here).
 *
 * Manual-entry field UI is genuinely different at this suite's default
 * viewport (375×812, mobile — see `cypress.config.ts`): `LimitSetter`
 * (`apps/core/.../molecules/limitSetter/index.js`) only renders a native
 * `<select>` at `>= 768px`; below that it's a tap target (placeholder text
 * "Insira um valor"/"Insira o tempo") that opens a bottom drawer
 * (`LimitValuesSelection`) — `<li role="button">` suggestion rows, and,
 * after tapping "Outro", the same `#lossLimit-custom`/`#sessionLimit-custom`
 * numeric input used on desktop plus the drawer's own
 * `#confirm-custom-value-button` to commit the typed value and close it.
 * This suite drives that mobile path — a desktop-viewport counterpart would
 * need `cy.viewport(...)` and different selectors for the picker itself.
 *
 * The choice-stage cards (`CardSelection`) are plain `<div>`s, not
 * `<button>`s — GrowthBook flag `fe_igp_rg_limits_layout` (absent from the
 * fixture, defaults to `3` → "minimalist" layout) makes the card's own
 * title double as the click target; a non-default layout value would
 * render separate `#max-limit-set-card-button`/`#manually-set-card-button`
 * buttons with different copy instead — not covered here since the
 * fixture's default never produces that shape.
 *
 * Not covered: back navigation (`RGLimits`'s own back arrow, unrelated to
 * the drawer above, is `display: none` above the mobile breakpoint — it
 * *is* reachable at this suite's viewport, just not exercised here) and
 * dismiss (there isn't one — `PostLoginVerificationModal` renders its outer
 * chrome with `hideClose` hardcoded `true`, test-locked in mono-fe's own
 * `PostLoginVerificationModal.spec.js`: "stays blocking: the activation
 * screens cannot be dismissed"). Also not covered: partial-failure handling
 * — lower value here than for the new-flow suite (this component has no
 * unit tests of its own, so there's less existing coverage to complement,
 * but this suite's job is still integration wiring, not exhaustive
 * behavior coverage).
 *
 * One real discrepancy worth flagging to whoever owns this screen, found
 * while writing this suite (not asserted below, since it isn't reachable
 * through the mobile UI this suite drives): `RGLimits/index.js`'s outer
 * confirm button reads `disabled={!canSubmit || !!errors?.lossLimit ||
 * !!errors?.sessionLimit}`, but the custom-value input's own over-max
 * validation (`limitSetter/index.js`) registers its error under
 * `errors['lossLimit-custom']`/`errors['sessionLimit-custom']` — a
 * different key that condition never checks, and `canSubmit`
 * (`useRequiredRGLimits.js`) itself only checks presence/non-negativity,
 * never the max. On the desktop (`>= 768px`) layout, where the custom field
 * sits directly in the form with no drawer gate, this would let an
 * over-max value through Confirm with only a red warning shown, never
 * blocking the submit. On mobile — the path this suite actually drives —
 * the drawer's *own* separate confirm button (`disabledConfirm =
 * !getValues(...) || !!errors[...]`) correctly disables on the same
 * over-max value, so the bad value can never reach the outer form's state
 * in the first place and the discrepancy above never manifests.
 */
describe('Legacy RG limits screen (pre-KIB-8557 RGLimits)', () => {
  const openLegacyRgScreen = () => {
    cy.visitAsLoggedInUser('/', { user_status: { name: 'PENDING' } })
    cy.dismissCookieBannerIfVisible()
    cy.contains('Escolha como definir seus limites', { timeout: 15000 }).should(
      'be.visible',
    )
    // The choice-stage title renders as soon as `RGLimits` mounts, but its
    // own `loadInitialData()` (`GET /limit/period` + `GET /limit`, fired by
    // a separate `useEffect`) is still in flight at that point — clicking
    // "Usar os limites máximos" before `periods` has loaded leaves
    // `processBothLimits` with no period to build a payload against, and
    // `POST /limit` never fires at all. Wait for periods explicitly rather
    // than relying on how fast a given run happens to be.
    cy.wait('@limitPeriods')
  }

  const openManualStage = () => {
    openLegacyRgScreen()
    cy.get('#manually-set-card').click()
    cy.contains('Defina seus limites').should('be.visible')
  }

  /**
   * `LimitSetter` renders one `DrawerBottomPortal` per field (loss and
   * session), both permanently mounted at `document.body` — the closed one
   * is hidden via `display: none` on its `<aside>`, not unmounted
   * (`drawerBottomPortal/styles.js`). Its `id`/`data-qa` props are never
   * passed by `LimitValuesSelection`, and `#confirm-custom-value-button` is
   * a literal id reused identically by both instances — so an unscoped
   * `cy.contains(...)`/`cy.get('#confirm-custom-value-button')` can just as
   * easily match the *other*, still-hidden field's copy. Every drawer
   * interaction below is scoped to the one `<aside>` that's actually
   * visible right now.
   */
  const openDrawer = () => cy.get('aside:visible')

  /**
   * Opens a field's value picker (tapping its placeholder text) and taps
   * "Outro" in the drawer that opens, revealing the custom numeric input —
   * `#{field}-custom` — ready to type into. Caller must then call
   * `confirmCustomValue` to commit the typed value and close the drawer
   * before interacting with anything else (it sits at a z-index above the
   * rest of the page).
   */
  const chooseOtherOption = (placeholder: string) => {
    cy.contains(placeholder).click()
    openDrawer().contains('li[role="button"]', 'Outro').click()
  }

  /** Commits the drawer's custom value and closes it. Only call once the button is enabled. */
  const confirmCustomValue = () => {
    openDrawer().find('#confirm-custom-value-button').click()
  }

  beforeEach(() => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_new_ui_experience: { defaultValue: false },
      fe_registration_loss_limits_enabled: { defaultValue: true },
    })
    cy.stubLimitPeriods()
    cy.stubSetLimit()
    cy.stubActiveSession()
    cy.acceptCookieBanner()
  })

  it('renders the choice stage with both methods', () => {
    openLegacyRgScreen()

    cy.contains(
      'A definição de limites é obrigatória. Escolha como você prefere fazer isso.',
    ).should('be.visible')
    cy.get('#max-limit-set-card')
      .should('be.visible')
      .and('contain.text', 'Usar os limites máximos')
    cy.get('#manually-set-card')
      .should('be.visible')
      .and('contain.text', 'Definir limites manualmente')
  })

  it('"Usar os limites máximos" submits immediately with the exact max-limit payloads (no confirm click, no "source" field)', () => {
    openLegacyRgScreen()

    cy.get('#max-limit-set-card').click()

    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        amount: '10000000',
        period_id: '1',
        duration: '1440',
        type: 'STOP_LOSS',
      })
    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        duration: '1440',
        period_id: '1',
        type: 'GAMING_SESSION',
      })
  })

  it('the manual "Outro" path sends the exact typed-value payloads for both limit types', () => {
    openManualStage()

    chooseOtherOption('Insira um valor')
    cy.get('#lossLimit-custom').type('50000')
    confirmCustomValue()

    chooseOtherOption('Insira o tempo')
    cy.get('#sessionLimit-custom').type('12') // hours — this field works in hours, unlike the new flow's minutes
    confirmCustomValue()

    cy.get('#confirm-limits-button').should('not.be.disabled').click()

    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        amount: '50000',
        period_id: '1',
        duration: '1440',
        type: 'STOP_LOSS',
      })
    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        duration: '720', // 12 hours * 60
        period_id: '1',
        type: 'GAMING_SESSION',
      })
  })

  it('a loss value over the max shows the warning and disables the drawer\'s own confirm — the bad value never reaches the form', () => {
    openManualStage()

    chooseOtherOption('Insira um valor')
    cy.get('#lossLimit-custom').type('50000000') // above the 10,000,000 max

    cy.contains('O valor não deve exceder 1 bilhão de reais.').should(
      'be.visible',
    )
    openDrawer().find('#confirm-custom-value-button').should('be.disabled')

    // Fixing the value re-enables the drawer's confirm and lets it through.
    cy.get('#lossLimit-custom').clear().type('50000')
    cy.contains('O valor não deve exceder 1 bilhão de reais.').should(
      'not.exist',
    )
    openDrawer().find('#confirm-custom-value-button').should('not.be.disabled')
    confirmCustomValue()

    cy.contains('Insira um valor').should('not.exist') // the field now shows the committed value, not its placeholder
  })

  it('a low (but valid) loss value shows the advisory without blocking the outer Confirm', () => {
    openManualStage()

    chooseOtherOption('Insira um valor')
    cy.get('#lossLimit-custom').type('5') // < low_loss_warning.Day (10)
    // The low-value advisory (`FieldDescription`'s swapped-in
    // `inputHelperWarning`) isn't a validation `error` the way the over-max
    // one is — react-hook-form's `validate` never flags "just low but
    // valid" — so there's no drawer-internal echo of it the way the
    // over-max warning has (that one renders via the custom field's own
    // `showErrorMsg`, inside the drawer). It only lives in the outer
    // `FieldDescription`, sibling to the drawer in the DOM — hidden behind
    // the drawer's own backdrop until the drawer closes.
    confirmCustomValue()

    chooseOtherOption('Insira o tempo')
    cy.get('#sessionLimit-custom').type('12')
    confirmCustomValue()

    cy.contains('Um limite baixo pode impedir você de apostar.').should(
      'be.visible',
    )
    cy.get('#confirm-limits-button').should('not.be.disabled')
  })
})
