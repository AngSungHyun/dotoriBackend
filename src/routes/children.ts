import { Router } from "express";
import { z } from "zod";
import type { Store } from "../domain/types.js";
import { asyncRoute, ApiError, parse } from "../lib/errors.js";
import { assertOwner, clientIp, publicRecord, requireAuthFor, routeParam } from "../lib/http.js";
import type { FileService } from "../services/file-service.js";

type ChildData = { name: string; birthDate: string; gender?: string; interests: string[]; pronouns?: string; notes?: string; personalityProfile?: PersonalityResult; anonymizedAt?: string };
type PersonalityResult = { scores: Record<Axis, number>; labels: string[]; assessedAt: string; overridden: boolean; assessmentId: string };
type AssessmentData = { childId: string; consentVersion: string; answers: Record<string, number>; scores?: Record<Axis, number>; rawType?: string; labels?: string[]; submittedAt?: string };
type Axis = "E" | "N" | "C" | "Q" | "S";

const childCreate = z.object({
  name: z.string().trim().min(1).max(50), birthDate: z.string().date(), gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(20).default([]), pronouns: z.string().trim().max(30).optional(), notes: z.string().trim().max(1000).optional(),
});
const childPatch = childCreate.partial().refine((value) => Object.keys(value).length > 0);

const questions: Array<{ id: string; text: string; axis: Axis; reverse?: boolean }> = [
  { id: "E1", text: "새로운 친구에게 먼저 다가가는 편인가요?", axis: "E" }, { id: "E2", text: "혼자 노는 시간이 더 편안한가요?", axis: "E", reverse: true },
  { id: "N1", text: "작은 소리나 변화에도 금방 알아차리나요?", axis: "N" }, { id: "N2", text: "낯선 환경에서도 쉽게 편안해지나요?", axis: "N", reverse: true },
  { id: "C1", text: "차례를 기다릴 수 있나요?", axis: "C" }, { id: "C2", text: "속상한 뒤 스스로 진정하는 편인가요?", axis: "C" },
  { id: "Q1", text: "왜 그런지 자주 질문하나요?", axis: "Q" }, { id: "Q2", text: "새로운 놀이 방법을 만들어 내나요?", axis: "Q" },
  { id: "S1", text: "친구의 기분을 살피나요?", axis: "S" }, { id: "S2", text: "함께 쓰는 물건을 나눌 수 있나요?", axis: "S" },
];

function calculate(answers: Record<string, number>): { scores: Record<Axis, number>; labels: string[]; rawType: string } {
  const axes: Axis[] = ["E", "N", "C", "Q", "S"];
  const scores = Object.fromEntries(axes.map((axis) => {
    const axisQuestions = questions.filter((q) => q.axis === axis);
    const average = axisQuestions.reduce((sum, q) => sum + (q.reverse ? 6 - answers[q.id]! : answers[q.id]!), 0) / axisQuestions.length;
    return [axis, Math.round(((average - 1) / 4) * 100)];
  })) as Record<Axis, number>;
  const labelMap: Record<Axis, [string, string]> = { E: ["차분히 관계를 살피는 아이", "친구에게 먼저 다가가는 아이"], N: ["변화에 유연한 아이", "마음을 섬세하게 느끼는 아이"], C: ["감정을 솔직히 표현하는 아이", "마음을 차근차근 조절하는 아이"], Q: ["익숙함에서 편안함을 찾는 아이", "새로운 것을 탐색하는 아이"], S: ["자기 생각이 또렷한 아이", "다른 마음을 다정히 살피는 아이"] };
  return { scores, labels: axes.map((axis) => labelMap[axis][scores[axis] >= 50 ? 1 : 0]), rawType: axes.map((axis) => scores[axis] >= 50 ? `${axis}+` : `${axis}-`).join("") };
}

export function childrenRouter(store: Store, files: FileService): Router {
  const router = Router();
  const memberAuth = requireAuthFor(store, true);
  // 역할/사용 시점: 동화 제작·성격 분석의 대상 선택 화면에서 내 자녀 프로필 목록을 조회한다.
  router.get("/children", memberAuth, asyncRoute(async (req, res) => {
    const records = await store.find<ChildData>("child", { ownerId: req.auth!.userId });
    res.json({ data: records.filter((item) => !item.data.anonymizedAt).map(publicRecord) });
  }));
  // 역할/사용 시점: 맞춤 동화에 사용할 이름, 생년월일, 관심사 등 자녀 기본 정보를 등록한다.
  router.post("/children", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(childCreate, req.body);
    const record = await store.create<ChildData>("child", { ownerId: req.auth!.userId, status: "ACTIVE", data: body });
    res.status(201).json({ data: publicRecord(record) });
  }));
  // 역할/사용 시점: 자녀 프로필 상세 화면이나 동화 입력값을 채울 때 단건 정보를 조회한다.
  router.get("/children/:childId", memberAuth, asyncRoute(async (req, res) => {
    const record = await store.get<ChildData>("child", routeParam(req.params.childId)); assertOwner(record, req.auth);
    res.json({ data: publicRecord(record) });
  }));
  // 역할/사용 시점: 성장에 따라 달라진 관심사·호칭·참고 사항을 기존 프로필에 부분 반영한다.
  router.patch("/children/:childId", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(childPatch, req.body); const record = await store.get<ChildData>("child", routeParam(req.params.childId)); assertOwner(record, req.auth);
    const updated = await store.update<ChildData>("child", record.id, { data: { ...record.data, ...body } });
    res.json({ data: publicRecord(updated!) });
  }));
  // 역할/사용 시점: 자녀 프로필 삭제 시 미구매 작업은 제거하고 구매 이력에 필요한 정보는 익명화한다.
  router.delete("/children/:childId", memberAuth, asyncRoute(async (req, res) => {
    const record = await store.get<ChildData>("child", routeParam(req.params.childId)); assertOwner(record, req.auth);
    const drafts = await store.find("storyDraft", { ownerId: req.auth!.userId });
    for (const draft of drafts.filter((item) => item.data.childId === record.id && item.status !== "PURCHASED")) {
      const data = draft.data as { avatars?: Array<{ fileId: string }>; generated?: { coverFileId: string; coverPreviewFileId: string; pages: Array<{ fileId: string; previewFileId: string }> } };
      const fileIds = [...(data.avatars ?? []).map((item) => item.fileId), ...(data.generated ? [data.generated.coverFileId, data.generated.coverPreviewFileId, ...data.generated.pages.flatMap((page) => [page.fileId, page.previewFileId])] : [])];
      for (const fileId of fileIds) await files.deleteFile(fileId);
      await store.delete("storyDraft", draft.id);
    }
    const stories = await store.find("story", { ownerId: req.auth!.userId });
    if (stories.some((item) => item.data.childId === record.id)) await store.update("child", record.id, { status: "ANONYMIZED", data: { ...record.data, name: "아이", interests: [], notes: undefined, personalityProfile: undefined, anonymizedAt: new Date().toISOString() } });
    else await store.delete("child", record.id);
    res.status(204).end();
  }));

  // 역할/사용 시점: 보호자 동의를 명시적으로 기록한 뒤 자녀 성격 설문을 새로 시작한다.
  router.post("/personality/assessments", memberAuth, asyncRoute(async (req, res) => {
    if (req.body?.guardianConsent !== true) throw new ApiError(403, "GUARDIAN_CONSENT_REQUIRED", "보호자 동의가 필요합니다.");
    const body = parse(z.object({ childId: z.string().uuid(), guardianConsent: z.literal(true), consentVersion: z.string().default("1.0") }), req.body);
    const child = await store.get<ChildData>("child", body.childId); assertOwner(child, req.auth);
    await store.create("consent", { ownerId: req.auth!.userId, relationId: child.id, lookup1: "CHILD_DATA", status: "AGREED", data: { type: "CHILD_DATA", version: body.consentVersion, agreed: true, ip: clientIp(req.ip), agreedAt: new Date().toISOString() } });
    const assessment = await store.create<AssessmentData>("personalityAssessment", { ownerId: req.auth!.userId, relationId: child.id, status: "IN_PROGRESS", data: { childId: child.id, consentVersion: body.consentVersion, answers: {} } });
    res.status(201).json({ data: { assessmentId: assessment.id, questions: questions.map(({ reverse: _, ...question }) => question), currentStep: 0 } });
  }));
  // 역할/사용 시점: 중단한 설문을 이어서 작성하거나 현재 응답·진행률·완료 결과를 확인한다.
  router.get("/personality/assessments/:id", memberAuth, asyncRoute(async (req, res) => {
    const assessment = await store.get<AssessmentData>("personalityAssessment", routeParam(req.params.id)); assertOwner(assessment, req.auth);
    const answered = Object.keys(assessment.data.answers).length;
    res.json({ data: { assessmentId: assessment.id, questions: questions.map(({ reverse: _, ...q }) => q), answers: assessment.data.answers, progress: Math.round((answered / questions.length) * 100), status: assessment.status, ...(assessment.data.scores ? { scores: assessment.data.scores, labels: assessment.data.labels } : {}) } });
  }));
  // 역할/사용 시점: 설문 진행 중 답변 일부를 임시 저장하며 제출된 평가는 다시 수정하지 못하게 한다.
  router.patch("/personality/assessments/:id", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ answers: z.array(z.object({ questionId: z.string(), value: z.number().int().min(1).max(5) })).min(1) }), req.body);
    const assessment = await store.get<AssessmentData>("personalityAssessment", routeParam(req.params.id)); assertOwner(assessment, req.auth);
    if (assessment.status === "SUBMITTED") throw new ApiError(409, "CONFLICT", "이미 제출한 평가입니다.");
    const answers = { ...assessment.data.answers };
    for (const answer of body.answers) { if (!questions.some((q) => q.id === answer.questionId)) throw new ApiError(400, "VALIDATION_FAILED", "알 수 없는 질문입니다."); answers[answer.questionId] = answer.value; }
    const updated = await store.update<AssessmentData>("personalityAssessment", assessment.id, { data: { ...assessment.data, answers } });
    res.json({ data: { assessmentId: assessment.id, answers, progress: Math.round((Object.keys(answers).length / questions.length) * 100), tiebreakerQuestions: [], updatedAt: updated!.updatedAt.toISOString() } });
  }));
  // 역할/사용 시점: 모든 필수 문항 응답을 5개 축 점수와 보호자 친화적 설명으로 계산해 확정한다.
  router.post("/personality/assessments/:id/submit", memberAuth, asyncRoute(async (req, res) => {
    const assessment = await store.get<AssessmentData>("personalityAssessment", routeParam(req.params.id)); assertOwner(assessment, req.auth);
    const missing = questions.filter((q) => assessment.data.answers[q.id] === undefined).map((q) => q.id);
    if (missing.length) throw new ApiError(400, "VALIDATION_FAILED", "필수 질문에 모두 답해 주세요.", missing.map((field) => ({ field, message: "응답이 필요합니다." })));
    const result = calculate(assessment.data.answers);
    await store.update<AssessmentData>("personalityAssessment", assessment.id, { status: "SUBMITTED", data: { ...assessment.data, ...result, submittedAt: new Date().toISOString() } });
    res.json({ data: { assessmentId: assessment.id, scores: result.scores, labels: result.labels, submittedAt: new Date().toISOString() } });
  }));
  // 역할/사용 시점: 제출된 평가를 자녀의 최종 성격 프로필로 저장하고 선택적 보호자 보정을 기록한다.
  router.put("/children/:childId/personality", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ assessmentId: z.string().uuid(), overrides: z.object({ E: z.number().min(0).max(100).optional(), N: z.number().min(0).max(100).optional(), C: z.number().min(0).max(100).optional(), Q: z.number().min(0).max(100).optional(), S: z.number().min(0).max(100).optional() }).optional() }), req.body);
    const child = await store.get<ChildData>("child", routeParam(req.params.childId)); assertOwner(child, req.auth);
    const assessment = await store.get<AssessmentData>("personalityAssessment", body.assessmentId); assertOwner(assessment, req.auth);
    if (assessment.relationId !== child.id || !assessment.data.scores) throw new ApiError(409, "CONFLICT", "제출 완료된 해당 자녀의 평가가 아닙니다.");
    const scores = { ...assessment.data.scores, ...(body.overrides ?? {}) };
    const profile: PersonalityResult = { scores, labels: calculate(Object.fromEntries(questions.map((q) => [q.id, 3]))).labels.map((_, index) => assessment.data.labels?.[index] ?? "균형 있게 성장하는 아이"), assessedAt: assessment.data.submittedAt!, overridden: Boolean(body.overrides && Object.keys(body.overrides).length), assessmentId: assessment.id };
    const updated = await store.update<ChildData>("child", child.id, { data: { ...child.data, personalityProfile: profile } });
    if (body.overrides) await store.create("consent", { ownerId: req.auth!.userId, relationId: child.id, lookup1: "PERSONALITY_OVERRIDE", status: "RECORDED", data: { assessmentId: assessment.id, overrides: body.overrides, createdAt: new Date().toISOString() } });
    res.json({ data: updated!.data.personalityProfile });
  }));
  // 역할/사용 시점: 동화 개인화와 자녀 상세 화면에서 최종 적용된 성격 프로필을 불러온다.
  router.get("/children/:childId/personality", memberAuth, asyncRoute(async (req, res) => {
    const child = await store.get<ChildData>("child", routeParam(req.params.childId)); assertOwner(child, req.auth);
    if (!child.data.personalityProfile) throw new ApiError(404, "NOT_FOUND", "저장된 성격 결과가 없습니다.");
    res.json({ data: child.data.personalityProfile });
  }));
  return router;
}
