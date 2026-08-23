import './commands'

/**
 * Slow-motion mode: inserts a pause after common commands so a human can
 * follow along in `cypress open`. Opt-in and off by default (0ms — no
 * behavior change for normal/headless runs). Enable with:
 *
 *   CYPRESS_SLOWMO=800 pnpm --filter e2e cypress:open
 *
 * (800 = milliseconds to pause after each command; pick whatever feels
 * watchable).
 */
const SLOWMO_MS = Number(Cypress.env('SLOWMO')) || 0

if (SLOWMO_MS > 0) {
  for (const command of [
    'visit',
    'click',
    'type',
    'clear',
    'check',
    'select',
    'trigger',
    'reload',
  ]) {
    Cypress.Commands.overwrite(command as never, (originalFn, ...args) => {
      const result = originalFn(...args)
      return new Cypress.Promise((resolve) => {
        setTimeout(() => resolve(result), SLOWMO_MS)
      })
    })
  }
}
