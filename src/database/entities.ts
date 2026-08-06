import { EntitySchema } from "@mikro-orm/core";
import type { RecordKind } from "../domain/types.js";

export class DbRecord {
  [key: string]: unknown;
  id!: string;
  ownerId?: string;
  guestId?: string;
  relationId?: string;
  status?: string;
  lookup1?: string;
  lookup2?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

type Column = { property: string; type: "string" | "text" | "boolean" | "integer" | "datetime" | "json"; fieldName?: string; length?: number; nullable?: boolean };
type Definition = { table: string; name: string; columns: Column[]; wholePayload?: boolean };
const s = (property: string, length = 191, nullable = true): Column => ({ property, type: "string", length, nullable });
const d = (property: string, nullable = true): Column => ({ property, type: "datetime", nullable });
const j = (property: string, nullable = true): Column => ({ property, type: "json", nullable });
const b = (property: string, nullable = false): Column => ({ property, type: "boolean", nullable });
const i = (property: string, nullable = false): Column => ({ property, type: "integer", nullable });

export const entityDefinitions: Record<RecordKind, Definition> = {
  user: { table: "users", name: "UserRecord", columns: [s("loginId", 20, false), s("email", 191, false), s("passwordHash", 255, false), s("name", 50, false), b("notificationEnabled"), b("freeStoryUsed"), d("deletedAt"), s("deletionReason", 500)] },
  refreshSession: { table: "refresh_sessions", name: "RefreshSessionRecord", columns: [s("tokenHash", 64, false), s("familyId", 36, false), d("expiresAt", false), d("revokedAt"), s("replacedById", 36)] },
  verification: { table: "verification_records", name: "VerificationRecord", columns: [s("email", 191, false), s("purpose", 40, false), s("codeHash", 64), s("tokenHash", 64), i("attempts"), d("expiresAt", false), d("confirmedAt"), d("usedAt"), j("payload")] },
  guestSession: { table: "guest_sessions", name: "GuestSessionRecord", columns: [s("deviceId", 200), s("tokenHash", 64, false), d("expiresAt", false), s("claimedByUserId", 36)] },
  consent: { table: "consent_histories", name: "ConsentHistoryRecord", columns: [s("type", 40, false), s("version", 30), b("agreed", true), s("ip", 64), d("agreedAt"), d("revokedAt"), s("assessmentId", 36), j("overrides")] },
  child: { table: "children", name: "ChildRecord", columns: [s("name", 50, false), s("birthDate", 10, false), s("gender", 20), j("interests", false), s("pronouns", 30), { property: "notes", type: "text", nullable: true }, j("personalityProfile"), d("anonymizedAt")] },
  personalityAssessment: { table: "personality_assessments", name: "PersonalityAssessmentRecord", columns: [s("childId", 36, false), s("consentVersion", 30, false), j("answers", false), j("scores"), s("rawType", 100), j("labels"), d("submittedAt")] },
  storyDraft: { table: "story_drafts", name: "StoryDraftRecord", columns: [j("payload", false)], wholePayload: true },
  generationJob: { table: "generation_jobs", name: "GenerationJobRecord", columns: [s("draftId", 36, false), s("type", 20, false), s("stage", 20, false), i("progress"), s("errorCode", 60), d("completedAt")] },
  story: { table: "stories", name: "StoryRecord", columns: [s("draftId", 36, false), s("childId", 36), s("childName", 50, false), s("title", 100, false), s("storyType", 20, false), s("coverFileId", 36, false), s("coverPreviewFileId", 36, false), j("pages", false), j("parentQuestions", false), s("orderId", 36, false), d("finalApprovedAt"), d("deletedAt"), d("fileDestructionScheduledAt")] },
  creditTransaction: { table: "credit_transactions", name: "CreditTransactionRecord", columns: [i("amount"), i("balanceAfter"), s("type", 30, false), s("referenceId", 36)] },
  subscription: { table: "subscriptions", name: "SubscriptionRecord", columns: [s("planId", 50, false), d("startedAt", false), d("currentPeriodEnd", false), b("cancelAtPeriodEnd")] },
  product: { table: "products", name: "ProductRecord", columns: [s("name", 100, false), { property: "description", type: "text", nullable: true }, i("price"), i("subscriberPrice", true), j("options"), b("active")] },
  cartItem: { table: "cart_items", name: "CartItemRecord", columns: [s("productId", 50, false), i("quantity"), s("storyId", 36), j("options")] },
  order: { table: "orders", name: "OrderRecord", columns: [j("items", false), i("amount"), s("paymentStatus", 30, false), s("orderStatus", 30, false), j("shipping"), j("gift"), s("giftMessage", 500), s("carrier", 80), s("trackingNumber", 100), s("trackingUrl", 500)] },
  gift: { table: "gifts", name: "GiftRecord", columns: [s("orderId", 36, false), s("codeHash", 64, false), s("message", 500), d("expiresAt", false)] },
  report: { table: "reports", name: "ReportRecord", columns: [s("draftId", 36), s("storyId", 36), s("category", 50, false), { property: "description", type: "text", nullable: false }] },
  b2bInquiry: { table: "b2b_inquiries", name: "B2BInquiryRecord", columns: [s("organizationName", 100, false), s("contactName", 50, false), s("email", 191, false), s("phone", 30, false), s("organizationType", 50, false), i("estimatedVolume"), { property: "message", type: "text", nullable: false }, b("privacyConsent")] },
  storedFile: { table: "stored_files", name: "StoredFileRecord", columns: [s("kind", 40, false), s("localPath", 1000, false), s("mimeType", 100, false), i("size"), d("expiresAt"), d("deletedAt")] },
  dataExport: { table: "data_exports", name: "DataExportRecord", columns: [s("fileId", 36), d("expiresAt"), s("errorCode", 60)] },
};

const commonProperties = {
  id: { type: "string", primary: true, length: 36 },
  ownerId: { type: "string", nullable: true, length: 36, fieldName: "owner_id", index: true },
  guestId: { type: "string", nullable: true, length: 36, fieldName: "guest_id", index: true },
  relationId: { type: "string", nullable: true, length: 36, fieldName: "relation_id", index: true },
  status: { type: "string", nullable: true, length: 40, index: true },
  lookup1: { type: "string", nullable: true, length: 191, index: true },
  lookup2: { type: "string", nullable: true, length: 191, index: true },
  createdAt: { type: "datetime", fieldName: "created_at" },
  updatedAt: { type: "datetime", fieldName: "updated_at" },
};

export const entityByKind = Object.fromEntries(Object.entries(entityDefinitions).map(([kind, definition]) => {
  class ConcreteRecord extends DbRecord {}
  Object.defineProperty(ConcreteRecord, "name", { value: definition.name });
  const domainProperties = Object.fromEntries(definition.columns.map((column) => [column.property, {
    type: column.type, nullable: column.nullable ?? true, ...(column.length ? { length: column.length } : {}),
    fieldName: column.fieldName ?? column.property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
  }]));
  return [kind, new EntitySchema({ class: ConcreteRecord, tableName: definition.table, properties: { ...commonProperties, ...domainProperties } } as never)];
})) as Record<RecordKind, EntitySchema<DbRecord>>;

export const entities = Object.values(entityByKind);

