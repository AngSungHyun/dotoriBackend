import { EntitySchema } from "@mikro-orm/core";
import type { RecordKind } from "../domain/types.js";

export class DbRecord {
  id!: string;
  ownerId?: string;
  guestId?: string;
  relationId?: string;
  status?: string;
  lookup1?: string;
  lookup2?: string;
  payload!: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
}

const definitions: Array<[RecordKind, string, string]> = [
  ["user", "UserRecord", "users"],
  ["refreshSession", "RefreshSessionRecord", "refresh_sessions"],
  ["verification", "VerificationRecord", "verification_records"],
  ["guestSession", "GuestSessionRecord", "guest_sessions"],
  ["consent", "ConsentHistoryRecord", "consent_histories"],
  ["child", "ChildRecord", "children"],
  ["personalityAssessment", "PersonalityAssessmentRecord", "personality_assessments"],
  ["storyDraft", "StoryDraftRecord", "story_drafts"],
  ["generationJob", "GenerationJobRecord", "generation_jobs"],
  ["story", "StoryRecord", "stories"],
  ["creditTransaction", "CreditTransactionRecord", "credit_transactions"],
  ["subscription", "SubscriptionRecord", "subscriptions"],
  ["product", "ProductRecord", "products"],
  ["cartItem", "CartItemRecord", "cart_items"],
  ["order", "OrderRecord", "orders"],
  ["gift", "GiftRecord", "gifts"],
  ["report", "ReportRecord", "reports"],
  ["b2bInquiry", "B2BInquiryRecord", "b2b_inquiries"],
  ["storedFile", "StoredFileRecord", "stored_files"],
  ["dataExport", "DataExportRecord", "data_exports"],
];

export const entityByKind = Object.fromEntries(definitions.map(([kind, name, tableName]) => {
  class ConcreteRecord extends DbRecord {}
  Object.defineProperty(ConcreteRecord, "name", { value: name });
  const schema = new EntitySchema({
    class: ConcreteRecord,
    tableName,
    properties: {
      id: { type: "string", primary: true, length: 36 },
      ownerId: { type: "string", nullable: true, length: 36, fieldName: "owner_id", index: true },
      guestId: { type: "string", nullable: true, length: 36, fieldName: "guest_id", index: true },
      relationId: { type: "string", nullable: true, length: 36, fieldName: "relation_id", index: true },
      status: { type: "string", nullable: true, length: 40, index: true },
      lookup1: { type: "string", nullable: true, length: 191, index: true },
      lookup2: { type: "string", nullable: true, length: 191, index: true },
      payload: { type: "json" },
      createdAt: { type: "datetime", fieldName: "created_at" },
      updatedAt: { type: "datetime", fieldName: "updated_at" },
    },
  });
  return [kind, schema];
})) as Record<RecordKind, EntitySchema<DbRecord>>;

export const entities = Object.values(entityByKind);

