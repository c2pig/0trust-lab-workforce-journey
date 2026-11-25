import { Firestore, Timestamp } from '@google-cloud/firestore';

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface FirestoreKvDoc {
  value: string;
  expireAt: Timestamp | { toMillis(): number } | null;
  updatedAt: Timestamp | { toMillis(): number };
  labSlug: string;
}

export interface FirestoreDocSnapshotLike {
  exists: boolean;
  data(): FirestoreKvDoc | undefined;
}

export interface FirestoreDocRefLike {
  get(): Promise<FirestoreDocSnapshotLike>;
  set(data: FirestoreKvDoc): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface FirestoreCollectionLike {
  doc(id: string): FirestoreDocRefLike;
}

export function buildKvDocId(labSlug: string, key: string): string {
  return `${labSlug}:${encodeURIComponent(key)}`;
}

export class FirestoreKvAdapter implements KVNamespace {
  private readonly collection: FirestoreCollectionLike;
  private readonly labSlug: string;
  private readonly nowFn: () => number;

  constructor(options: {
    labSlug: string;
    collectionName?: string;
    firestore?: Firestore;
    collectionRef?: FirestoreCollectionLike;
    nowFn?: () => number;
  }) {
    this.labSlug = options.labSlug;
    this.nowFn = options.nowFn ?? (() => Date.now());
    if (options.collectionRef) {
      this.collection = options.collectionRef;
    } else {
      const db = options.firestore ?? new Firestore();
      this.collection = db.collection(
        options.collectionName || 'kv_state'
      ) as unknown as FirestoreCollectionLike;
    }
  }

  async get(key: string): Promise<string | null> {
    const docId = buildKvDocId(this.labSlug, key);
    const snap = await this.collection.doc(docId).get();
    if (!snap.exists) {
      return null;
    }
    const doc = snap.data();
    if (!doc) {
      return null;
    }
    // Synchronous TTL check: never rely on Firestore's eventual background TTL reaper
    if (doc.expireAt && doc.expireAt.toMillis() <= this.nowFn()) {
      return null;
    }
    return typeof doc.value === 'string' ? doc.value : null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void> {
    const docId = buildKvDocId(this.labSlug, key);
    const nowMs = this.nowFn();
    const ttlSeconds = options?.expirationTtl;
    const expireAt =
      typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? Timestamp.fromMillis(nowMs + Math.floor(ttlSeconds * 1000))
        : null;

    await this.collection.doc(docId).set({
      value,
      expireAt,
      updatedAt: Timestamp.fromMillis(nowMs),
      labSlug: this.labSlug
    });
  }

  async delete(key: string): Promise<void> {
    const docId = buildKvDocId(this.labSlug, key);
    await this.collection.doc(docId).delete();
  }
}

interface MemoryKvEntry {
  value: string;
  expireAtMs: number | null;
  updatedAtMs: number;
  labSlug: string;
}

export class MemoryKvAdapter implements KVNamespace {
  private readonly store = new Map<string, MemoryKvEntry>();
  private readonly labSlug: string;
  private readonly nowFn: () => number;

  constructor(options: { labSlug: string; nowFn?: () => number }) {
    this.labSlug = options.labSlug;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  async get(key: string): Promise<string | null> {
    const docId = buildKvDocId(this.labSlug, key);
    const entry = this.store.get(docId);
    if (!entry) {
      return null;
    }
    if (entry.expireAtMs !== null && entry.expireAtMs <= this.nowFn()) {
      this.store.delete(docId);
      return null;
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void> {
    const docId = buildKvDocId(this.labSlug, key);
    const nowMs = this.nowFn();
    const ttlSeconds = options?.expirationTtl;
    const expireAtMs =
      typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? nowMs + Math.floor(ttlSeconds * 1000)
        : null;

    this.store.set(docId, {
      value,
      expireAtMs,
      updatedAtMs: nowMs,
      labSlug: this.labSlug
    });
  }

  async delete(key: string): Promise<void> {
    const docId = buildKvDocId(this.labSlug, key);
    this.store.delete(docId);
  }
}

export function shouldUseFirestore(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KV_BACKEND === 'memory') {
    return false;
  }
  return Boolean(
    env.FIRESTORE_EMULATOR_HOST ||
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      env.K_SERVICE ||
      env.GOOGLE_CLOUD_PROJECT ||
      env.GCP_PROJECT
  );
}

export function createKvAdapter(options?: {
  labSlug?: string;
  collectionName?: string;
  env?: NodeJS.ProcessEnv;
}): KVNamespace {
  const env = options?.env ?? process.env;
  const labSlug = options?.labSlug || env.LAB_SLUG || 'unknown-lab';
  const collectionName = options?.collectionName || env.FIRESTORE_COLLECTION || 'kv_state';

  if (shouldUseFirestore(env)) {
    return new FirestoreKvAdapter({ labSlug, collectionName });
  }
  return new MemoryKvAdapter({ labSlug });
}
