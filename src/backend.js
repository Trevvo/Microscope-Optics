// Storage + auth backends with one interface:
//   onAuth(cb) signIn(user, pass) signOut()
//   watchConfigs(cb) watchConfig(id, cb) createConfig(content) saveConfig(id, content)
//   addRevision(id, snapshot, label) listRevisions(id)
//   watchCustomSpectra(cb) addCustomSpectrum({name, cat, sub, data})
//   watchInventory(cb) saveInventory(ids)   — the lab's "our filters" list (null until first saved)
// FirebaseBackend is used when src/firebase-config.js has an apiKey; otherwise
// LocalBackend keeps everything in localStorage (single-browser dev mode).

import { firebaseConfig, USERNAME_DOMAIN } from './firebase-config.js';

const sessionId = Math.random().toString(36).slice(2, 10);

export async function makeBackend() {
  if (firebaseConfig.apiKey) return new FirebaseBackend().init();
  return new LocalBackend();
}

class FirebaseBackend {
  mode = 'firebase';
  sessionId = sessionId;

  async init() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
    this.a = auth;
    this.f = fs;
    const app = initializeApp(firebaseConfig);
    this.auth = auth.getAuth(app);
    this.db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
    return this;
  }

  get userName() {
    const e = this.auth.currentUser?.email ?? '';
    return e.endsWith(`@${USERNAME_DOMAIN}`) ? e.slice(0, -USERNAME_DOMAIN.length - 1) : e;
  }

  onAuth(cb) {
    return this.a.onAuthStateChanged(this.auth, (u) => cb(u ? { name: this.userName } : null));
  }

  async signIn(username, password) {
    const email = username.includes('@') ? username : `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`;
    await this.a.signInWithEmailAndPassword(this.auth, email, password);
  }

  signOut() {
    return this.a.signOut(this.auth);
  }

  watchConfigs(cb) {
    const { collection, onSnapshot } = this.f;
    return onSnapshot(collection(this.db, 'configs'), (snap) =>
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    );
  }

  watchConfig(id, cb) {
    const { doc, onSnapshot } = this.f;
    return onSnapshot(doc(this.db, 'configs', id), (d) => {
      if (!d.exists()) return cb(null, { fromMe: false });
      const data = d.data({ serverTimestamps: 'estimate' });
      cb({ id: d.id, ...data }, { fromMe: d.metadata.hasPendingWrites || data.updatedSession === sessionId });
    });
  }

  stamp() {
    return { updatedAt: this.f.serverTimestamp(), updatedBy: this.userName, updatedSession: sessionId };
  }

  async createConfig(content) {
    const { collection, addDoc } = this.f;
    const ref = await addDoc(collection(this.db, 'configs'), { ...content, ...this.stamp() });
    return ref.id;
  }

  saveConfig(id, content) {
    const { doc, setDoc } = this.f;
    return setDoc(doc(this.db, 'configs', id), { ...content, ...this.stamp() });
  }

  addRevision(id, snapshot, label = '') {
    const { collection, addDoc, serverTimestamp } = this.f;
    return addDoc(collection(this.db, 'configs', id, 'revisions'), {
      snapshot, label, savedBy: this.userName, savedAt: serverTimestamp(),
    });
  }

  async listRevisions(id) {
    const { collection, getDocs, query, orderBy, limit } = this.f;
    const snap = await getDocs(query(collection(this.db, 'configs', id, 'revisions'), orderBy('savedAt', 'desc'), limit(100)));
    return snap.docs.map((d) => {
      const r = d.data({ serverTimestamps: 'estimate' });
      return { id: d.id, ...r, savedAt: r.savedAt?.toDate?.() ?? new Date() };
    });
  }

  watchCustomSpectra(cb) {
    const { collection, onSnapshot } = this.f;
    return onSnapshot(collection(this.db, 'customSpectra'), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }

  watchInventory(cb) {
    const { doc, onSnapshot } = this.f;
    return onSnapshot(doc(this.db, 'settings', 'inventory'), (d) => cb(d.exists() ? d.data().ids ?? [] : null));
  }

  saveInventory(ids) {
    const { doc, setDoc, serverTimestamp } = this.f;
    return setDoc(doc(this.db, 'settings', 'inventory'), { ids, updatedBy: this.userName, updatedAt: serverTimestamp() });
  }

  async addCustomSpectrum(s) {
    const { collection, addDoc, serverTimestamp } = this.f;
    const ref = await addDoc(collection(this.db, 'customSpectra'), {
      ...s, createdBy: this.userName, createdAt: serverTimestamp(),
    });
    return ref.id;
  }
}

// ---------------------------------------------------------------------------

const LS = 'microscope-optics:v1';

class LocalBackend {
  mode = 'local';
  sessionId = sessionId;
  userName = 'local';
  listeners = { configs: new Set(), config: new Map(), custom: new Set(), inventory: new Set() };

  constructor() {
    try {
      this.data = JSON.parse(localStorage.getItem(LS)) ?? null;
    } catch {
      this.data = null;
    }
    this.data ??= { configs: {}, revisions: {}, custom: {} };
    // Other tabs editing the same localStorage behave like other users.
    window.addEventListener('storage', (e) => {
      if (e.key !== LS) return;
      this.data = JSON.parse(e.newValue);
      this.emit(false);
    });
  }

  persist() {
    try {
      localStorage.setItem(LS, JSON.stringify(this.data));
    } catch (e) {
      console.warn('localStorage write failed', e);
    }
  }

  emit(fromMe = true) {
    const list = Object.entries(this.data.configs).map(([id, d]) => ({ id, ...d }));
    this.listeners.configs.forEach((cb) => cb(list));
    for (const [id, cbs] of this.listeners.config) {
      const d = this.data.configs[id];
      cbs.forEach((cb) => cb(d ? { id, ...d } : null, { fromMe }));
    }
    const custom = Object.entries(this.data.custom).map(([id, d]) => ({ id, ...d }));
    this.listeners.custom.forEach((cb) => cb(custom));
    this.listeners.inventory.forEach((cb) => cb(this.data.inventory ?? null));
  }

  watchInventory(cb) {
    this.listeners.inventory.add(cb);
    queueMicrotask(() => cb(this.data.inventory ?? null));
    return () => this.listeners.inventory.delete(cb);
  }

  async saveInventory(ids) {
    this.data.inventory = ids;
    this.persist();
    this.emit();
  }

  onAuth(cb) {
    queueMicrotask(() => cb({ name: 'local' }));
    return () => {};
  }
  async signIn() {}
  async signOut() {}

  watchConfigs(cb) {
    this.listeners.configs.add(cb);
    queueMicrotask(() => cb(Object.entries(this.data.configs).map(([id, d]) => ({ id, ...d }))));
    return () => this.listeners.configs.delete(cb);
  }

  watchConfig(id, cb) {
    if (!this.listeners.config.has(id)) this.listeners.config.set(id, new Set());
    this.listeners.config.get(id).add(cb);
    queueMicrotask(() => {
      const d = this.data.configs[id];
      cb(d ? { id, ...d } : null, { fromMe: true });
    });
    return () => this.listeners.config.get(id)?.delete(cb);
  }

  stamp() {
    return { updatedAt: new Date().toISOString(), updatedBy: this.userName, updatedSession: sessionId };
  }

  async createConfig(content) {
    const id = Math.random().toString(36).slice(2, 12);
    this.data.configs[id] = { ...content, ...this.stamp() };
    this.persist();
    this.emit();
    return id;
  }

  async saveConfig(id, content) {
    this.data.configs[id] = { ...content, ...this.stamp() };
    this.persist();
    this.emit();
  }

  async addRevision(id, snapshot, label = '') {
    (this.data.revisions[id] ??= []).unshift({
      id: Math.random().toString(36).slice(2, 10), snapshot, label, savedBy: this.userName, savedAt: new Date().toISOString(),
    });
    this.data.revisions[id] = this.data.revisions[id].slice(0, 100);
    this.persist();
  }

  async listRevisions(id) {
    return (this.data.revisions[id] ?? []).map((r) => ({ ...r, savedAt: new Date(r.savedAt) }));
  }

  watchCustomSpectra(cb) {
    this.listeners.custom.add(cb);
    queueMicrotask(() => cb(Object.entries(this.data.custom).map(([id, d]) => ({ id, ...d }))));
    return () => this.listeners.custom.delete(cb);
  }

  async addCustomSpectrum(s) {
    const id = Math.random().toString(36).slice(2, 12);
    this.data.custom[id] = { ...s, createdBy: this.userName };
    this.persist();
    this.emit();
    return id;
  }
}
