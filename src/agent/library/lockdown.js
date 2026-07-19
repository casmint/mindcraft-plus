import 'ses';

// This sets up the secure environment
// We disable some of the taming to allow for more flexibility

// For configuration, see https://github.com/endojs/endo/blob/master/packages/ses/docs/lockdown.md

const sesLockdown = globalThis.lockdown;
let lockeddown = false;

if (typeof sesLockdown !== 'function') {
  throw new Error('SES did not install a global lockdown function.');
}

export function lockdown() {
  if (lockeddown) return false;

  sesLockdown({
    // basic devex and quality of life improvements
    localeTaming: 'unsafe',
    consoleTaming: 'unsafe',
    errorTaming: 'unsafe',
    stackFiltering: 'verbose',
    // allow eval outside of created compartments
    // (mineflayer dep "protodef" uses eval)
    evalTaming: 'unsafeEval',
  });
  lockeddown = true;
  return true;
}

export function isLockdownInitialized() {
  return lockeddown;
}

export const makeCompartment = (endowments = {}) => {
  lockdown();
  return new Compartment({
    // provide untamed Math, Date, etc
    Math,
    Date,
    // standard endowments
    ...endowments
  });
}
