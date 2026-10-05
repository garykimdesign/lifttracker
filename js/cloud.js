// Thin Firebase wrapper. The SDK is imported lazily from the gstatic CDN so the app
// boots instantly (and offline) without it; it's only fetched when a cloud session
// is restored or the user taps "Sign in".
import { firebaseConfig, FIREBASE_VERSION, CLOUD_ENABLED } from './firebase-config.js';
import { sanitize } from './utils.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

let fb = null;        // { app, auth, db, mods }
let initPromise = null;

export const cloud = {
  enabled: CLOUD_ENABLED && !!firebaseConfig?.apiKey,

  async init() {
    if (!this.enabled) throw new Error('Cloud sync is disabled');
    if (fb) return fb;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const [appM, authM, fsM] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
      ]);
      const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(firebaseConfig);
      const auth = authM.getAuth(app);
      let db;
      try {
        db = fsM.initializeFirestore(
          app,
          { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) },
          firebaseConfig.firestoreDatabaseId || '(default)'
        );
      } catch (e) {
        console.warn('Persistent cache unavailable, using memory cache', e);
        db = fsM.getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
      }
      fsM.setLogLevel?.('error');
      fb = { app, auth, db, authM, fsM };
      return fb;
    })();
    return initPromise;
  },

  get ready() { return !!fb; },

  /** Resolve the current user (after SDK init). cb(userOrNull) fires on every auth change. */
  async onAuth(cb) {
    const { auth, authM } = await this.init();
    // Complete a redirect sign-in if one is pending (mobile fallback path)
    authM.getRedirectResult(auth).catch(() => {});
    return authM.onAuthStateChanged(auth, cb);
  },

  async signIn() {
    const { auth, authM } = await this.init();
    const provider = new authM.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      return await authM.signInWithPopup(auth, provider);
    } catch (e) {
      // Popups are blocked in some installed-PWA / in-app-browser contexts: fall back to redirect.
      if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
        if (e.code === 'auth/popup-closed-by-user') throw e;
        return authM.signInWithRedirect(auth, provider);
      }
      throw e;
    }
  },

  async signOut() {
    if (!fb) return;
    await fb.authM.signOut(fb.auth);
  },

  // ---------- Firestore helpers ----------
  doc(path) { const { db, fsM } = fb; return fsM.doc(db, ...path.split('/')); },

  async set(path, data, merge = false) {
    const { fsM } = await this.init();
    return fsM.setDoc(this.doc(path), sanitize(data), merge ? { merge: true } : undefined);
  },
  async get(path) {
    const { fsM } = await this.init();
    const snap = await fsM.getDoc(this.doc(path));
    return snap.exists() ? snap.data() : null;
  },
  async del(path) {
    const { fsM } = await this.init();
    return fsM.deleteDoc(this.doc(path));
  },
  /** Batched writes, automatically chunked under Firestore's 500-op limit. */
  async batch(ops) {
    const { db, fsM } = await this.init();
    for (let i = 0; i < ops.length; i += 400) {
      const b = fsM.writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        const ref = this.doc(op.path);
        if (op.type === 'delete') b.delete(ref);
        else b.set(ref, sanitize(op.data), op.merge ? { merge: true } : undefined);
      }
      await b.commit();
    }
  },
  async listWhere(coll, field, value) {
    const { db, fsM } = await this.init();
    const q = fsM.query(fsM.collection(db, coll), fsM.where(field, '==', value));
    const snap = await fsM.getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  /** Live query on a collection filtered by userId. cb(docs, meta). Returns unsubscribe. */
  watchWhere(coll, field, value, cb, onErr) {
    const { db, fsM } = fb;
    const q = fsM.query(fsM.collection(db, coll), fsM.where(field, '==', value));
    return fsM.onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
      cb(snap.docs.map((d) => ({ ...d.data(), id: d.id })), { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
    }, (e) => { console.warn(`watch ${coll} failed`, e); onErr?.(e); });
  },
  watchDoc(path, cb, onErr) {
    const { fsM } = fb;
    return fsM.onSnapshot(this.doc(path), (snap) => {
      cb(snap.exists() ? snap.data() : null, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
    }, (e) => { console.warn(`watch ${path} failed`, e); onErr?.(e); });
  },
};
