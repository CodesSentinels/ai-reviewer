export const info = (...args: unknown[]) => console.log('[info]', ...args)
export const warning = (...args: unknown[]) =>
  console.warn('[warning]', ...args)
export const error = (...args: unknown[]) =>
  console.error('[error]', ...args)
export const debug = (...args: unknown[]) =>
  console.debug('[debug]', ...args)
export const getInput = () => ''
export const setOutput = () => {}
export const setFailed = () => {}
