import { randomUUID } from "node:crypto";
import { RequestContext, type EntityManager } from "@mikro-orm/mysql";
import { entityByKind, entityDefinitions, type DbRecord } from "../database/entities.js";
import type { RecordInput, RecordKind, RecordQuery, Store, StoredRecord } from "../domain/types.js";

function matches(record: StoredRecord, query: RecordQuery): boolean {
  return Object.entries(query).every(([key, value]) => value === undefined || record[key as keyof StoredRecord] === value);
}

export class MemoryStore implements Store {
  private readonly records = new Map<RecordKind, Map<string, StoredRecord>>();

  async create<T extends Record<string, unknown>>(kind: RecordKind, input: RecordInput<T>): Promise<StoredRecord<T>> {
    const now = new Date();
    const record: StoredRecord<T> = { id: input.id ?? randomUUID(), data: structuredClone(input.data), createdAt: now, updatedAt: now };
    for (const key of ["ownerId", "guestId", "relationId", "status", "lookup1", "lookup2"] as const) {
      if (input[key] !== undefined) record[key] = input[key];
    }
    const bucket = this.records.get(kind) ?? new Map();
    bucket.set(record.id, record);
    this.records.set(kind, bucket);
    return structuredClone(record);
  }

  async get<T extends Record<string, unknown>>(kind: RecordKind, id: string): Promise<StoredRecord<T> | null> {
    const record = this.records.get(kind)?.get(id);
    return record ? structuredClone(record as StoredRecord<T>) : null;
  }

  async find<T extends Record<string, unknown>>(kind: RecordKind, query: RecordQuery = {}): Promise<StoredRecord<T>[]> {
    return [...(this.records.get(kind)?.values() ?? [])]
      .filter((record) => matches(record, query))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((record) => structuredClone(record as StoredRecord<T>));
  }

  async update<T extends Record<string, unknown>>(kind: RecordKind, id: string, patch: Partial<RecordInput<T>>): Promise<StoredRecord<T> | null> {
    const bucket = this.records.get(kind);
    const record = bucket?.get(id);
    if (!record || !bucket) return null;
    if (patch.data) record.data = structuredClone(patch.data);
    for (const key of ["ownerId", "guestId", "relationId", "status", "lookup1", "lookup2"] as const) {
      if (patch[key] !== undefined) record[key] = patch[key];
    }
    record.updatedAt = new Date();
    bucket.set(id, record);
    return structuredClone(record as StoredRecord<T>);
  }

  async delete(kind: RecordKind, id: string): Promise<boolean> {
    return this.records.get(kind)?.delete(id) ?? false;
  }
}

function dataFromEntity(kind: RecordKind, entity: DbRecord): Record<string, unknown> {
  const definition = entityDefinitions[kind];
  if (definition.wholePayload) return entity.payload as Record<string, unknown>;
  const data = Object.fromEntries(definition.columns.filter((column) => entity[column.property] !== null && entity[column.property] !== undefined).map((column) => {
    const value = entity[column.property];
    return [column.property, column.type === "datetime" && value instanceof Date ? value.toISOString() : value];
  }));
  if (entity.status !== undefined) data.status = entity.status;
  return data;
}

function toEntityData(kind: RecordKind, data: Record<string, unknown>): Record<string, unknown> {
  const definition = entityDefinitions[kind];
  if (definition.wholePayload) return { payload: data };
  return Object.fromEntries(definition.columns.map((column) => {
    const value = data[column.property];
    return [column.property, column.type === "datetime" && typeof value === "string" ? new Date(value) : value ?? null];
  }));
}

function fromEntity<T extends Record<string, unknown>>(kind: RecordKind, entity: DbRecord): StoredRecord<T> {
  const result: StoredRecord<T> = {
    id: entity.id,
    data: dataFromEntity(kind, entity) as T,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
  for (const key of ["ownerId", "guestId", "relationId", "status", "lookup1", "lookup2"] as const) {
    if (entity[key] !== undefined && entity[key] !== null) result[key] = entity[key];
  }
  return result;
}

export class OrmStore implements Store {
  constructor(private readonly rootEm: EntityManager) {}

  private currentEm(): EntityManager {
    return (RequestContext.getEntityManager() as EntityManager | undefined) ?? this.rootEm.fork();
  }

  async create<T extends Record<string, unknown>>(kind: RecordKind, input: RecordInput<T>): Promise<StoredRecord<T>> {
    const em = this.currentEm();
    const now = new Date();
    const entity = em.getRepository(entityByKind[kind]).create({
      id: input.id ?? randomUUID(), ...toEntityData(kind, input.data), createdAt: now, updatedAt: now,
      ownerId: input.ownerId, guestId: input.guestId, relationId: input.relationId,
      status: input.status, lookup1: input.lookup1, lookup2: input.lookup2,
    } as never);
    await em.persistAndFlush(entity);
    return fromEntity<T>(kind, entity as DbRecord);
  }

  async get<T extends Record<string, unknown>>(kind: RecordKind, id: string): Promise<StoredRecord<T> | null> {
    const em = this.currentEm();
    const entity = await em.getRepository(entityByKind[kind]).findOne({ id } as never);
    return entity ? fromEntity<T>(kind, entity as DbRecord) : null;
  }

  async find<T extends Record<string, unknown>>(kind: RecordKind, query: RecordQuery = {}): Promise<StoredRecord<T>[]> {
    const em = this.currentEm();
    const where = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
    const entitiesFound = await em.getRepository(entityByKind[kind]).find(where as never, { orderBy: { createdAt: "desc" } as never });
    return entitiesFound.map((entity) => fromEntity<T>(kind, entity as DbRecord));
  }

  async update<T extends Record<string, unknown>>(kind: RecordKind, id: string, patch: Partial<RecordInput<T>>): Promise<StoredRecord<T> | null> {
    const em = this.currentEm();
    const entity = await em.getRepository(entityByKind[kind]).findOne({ id } as never);
    if (!entity) return null;
    if (patch.data) Object.assign(entity as DbRecord, toEntityData(kind, patch.data));
    for (const key of ["ownerId", "guestId", "relationId", "status", "lookup1", "lookup2"] as const) {
      if (patch[key] !== undefined) (entity as DbRecord)[key] = patch[key];
    }
    (entity as DbRecord).updatedAt = new Date();
    await em.flush();
    return fromEntity<T>(kind, entity as DbRecord);
  }

  async delete(kind: RecordKind, id: string): Promise<boolean> {
    const em = this.currentEm();
    const entity = await em.getRepository(entityByKind[kind]).findOne({ id } as never);
    if (!entity) return false;
    await em.removeAndFlush(entity);
    return true;
  }
}
