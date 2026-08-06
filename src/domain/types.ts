export const recordKinds = [
  "user", "refreshSession", "verification", "guestSession", "consent", "child",
  "personalityAssessment", "storyDraft", "generationJob", "story", "creditTransaction",
  "subscription", "product", "cartItem", "order", "gift", "report", "b2bInquiry",
  "storedFile", "dataExport",
] as const;

export type RecordKind = (typeof recordKinds)[number];

export interface StoredRecord<T = Record<string, unknown>> {
  id: string;
  ownerId?: string;
  guestId?: string;
  relationId?: string;
  status?: string;
  lookup1?: string;
  lookup2?: string;
  data: T;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordQuery {
  ownerId?: string;
  guestId?: string;
  relationId?: string;
  status?: string;
  lookup1?: string;
  lookup2?: string;
}

export interface RecordInput<T> extends RecordQuery {
  id?: string;
  data: T;
}

export interface Store {
  create<T extends Record<string, unknown>>(kind: RecordKind, input: RecordInput<T>): Promise<StoredRecord<T>>;
  get<T extends Record<string, unknown>>(kind: RecordKind, id: string): Promise<StoredRecord<T> | null>;
  find<T extends Record<string, unknown>>(kind: RecordKind, query?: RecordQuery): Promise<StoredRecord<T>[]>;
  update<T extends Record<string, unknown>>(kind: RecordKind, id: string, patch: Partial<RecordInput<T>>): Promise<StoredRecord<T> | null>;
  delete(kind: RecordKind, id: string): Promise<boolean>;
}

export type AuthContext = { userId?: string; guestSessionId?: string };

