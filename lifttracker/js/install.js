// PWA install prompt capture (Chrome/Android `beforeinstallprompt`).
export const installState = { canInstall: false, installed: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true };
let deferred = null;
const listeners = new Set();
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => { for (const fn of listeners) fn(); };

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; installState.canInstall = true; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; installState.canInstall = false; installState.installed = true; notify(); });

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome === 'accepted') { deferred = null; installState.canInstall = false; notify(); }
  return outcome === 'accepted';
}
