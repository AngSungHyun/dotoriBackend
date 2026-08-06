import { Router } from "express";
import { z } from "zod";
import { billingPlans, products } from "../domain/catalog.js";
import type { Store } from "../domain/types.js";
import { asyncRoute, ApiError, parse } from "../lib/errors.js";
import { assertOwner, paginate, paginationSchema, requireAuthFor, routeParam } from "../lib/http.js";
import { randomToken, sha256 } from "../lib/security.js";
import type { FileService } from "../services/file-service.js";

type CreditData = { amount: number; balanceAfter: number; type: string; referenceId?: string };
type SubscriptionData = { planId: string; status: string; startedAt: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean };
type CartData = { productId: string; quantity: number; storyId?: string; options?: Record<string, unknown> };
type OrderData = { items: Array<{ productId: string; quantity: number; amount: number; storyId?: string; options?: Record<string, unknown> }>; amount: number; paymentStatus: string; orderStatus: string; shipping?: Record<string, unknown>; giftMessage?: string; carrier: null; trackingNumber: null; trackingUrl: null };
type GiftData = { orderId: string; codeHash: string; message?: string; status: string; expiresAt: string };
type ExportData = { status: string; fileId?: string; expiresAt?: string; errorCode?: string };

function productById(id: string) { return products.find((item) => item.id === id && item.active); }

async function unitPrice(store: Store, userId: string, productId: string): Promise<number> {
  const product = productById(productId);
  if (!product) throw new ApiError(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
  const active = (await store.find<SubscriptionData>("subscription", { ownerId: userId, status: "ACTIVE" }))[0];
  return active && product.subscriberPrice !== null ? product.subscriberPrice : product.price;
}

export function commerceRouter(store: Store, files: FileService): Router {
  const router = Router();
  const anyAuth = requireAuthFor(store);
  const memberAuth = requireAuthFor(store, true);

  // 역할/사용 시점: 재생성 화면과 마이페이지에서 현재 크레딧 잔액 및 증감 이력을 조회한다.
  router.get("/me/credits", memberAuth, asyncRoute(async (req, res) => {
    const { page, pageSize } = parse(paginationSchema, req.query); const txs = await store.find<CreditData>("creditTransaction", { ownerId: req.auth!.userId });
    const result = paginate(txs.map((item) => ({ id: item.id, ...item.data, createdAt: item.createdAt.toISOString() })), page, pageSize);
    res.json({ data: { balance: txs[0]?.data.balanceAfter ?? 0, transactions: result.data }, meta: result.meta });
  }));
  // 역할/사용 시점: 구독 관리 화면에서 현재 구독 상태와 다음 기간, 해지 예약 여부를 조회한다.
  router.get("/me/subscription", memberAuth, asyncRoute(async (req, res) => {
    const subscription = (await store.find<SubscriptionData>("subscription", { ownerId: req.auth!.userId }))[0]; res.json({ data: subscription ? { id: subscription.id, ...subscription.data } : null });
  }));
  // 역할/사용 시점: 디지털 월 구독을 시작하고 결제 완료 상태 및 재생성 크레딧을 즉시 반영한다.
  router.post("/me/subscription", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ planId: z.literal("DIGITAL_MONTHLY"), paymentMethodToken: z.string().optional() }), req.body);
    const existing = (await store.find<SubscriptionData>("subscription", { ownerId: req.auth!.userId, status: "ACTIVE" }))[0]; if (existing) throw new ApiError(409, "CONFLICT", "이미 활성 구독이 있습니다.");
    const startedAt = new Date(); const currentPeriodEnd = new Date(startedAt); currentPeriodEnd.setUTCMonth(currentPeriodEnd.getUTCMonth() + 1);
    const subscription = await store.create<SubscriptionData>("subscription", { ownerId: req.auth!.userId, lookup1: body.planId, status: "ACTIVE", data: { planId: body.planId, status: "ACTIVE", startedAt: startedAt.toISOString(), currentPeriodEnd: currentPeriodEnd.toISOString(), cancelAtPeriodEnd: false } });
    const txs = await store.find<CreditData>("creditTransaction", { ownerId: req.auth!.userId }); const balance = txs[0]?.data.balanceAfter ?? 0;
    await store.create<CreditData>("creditTransaction", { ownerId: req.auth!.userId, relationId: subscription.id, status: "COMPLETED", data: { amount: 1, balanceAfter: balance + 1, type: "SUBSCRIPTION", referenceId: subscription.id } });
    res.status(201).json({ data: { id: subscription.id, ...subscription.data, paymentStatus: "PAID" } });
  }));
  // 역할/사용 시점: 구독 해지 요청 시 남은 이용 기간을 보장하도록 기간 종료 해지를 예약한다.
  router.delete("/me/subscription", memberAuth, asyncRoute(async (req, res) => {
    const subscription = (await store.find<SubscriptionData>("subscription", { ownerId: req.auth!.userId, status: "ACTIVE" }))[0]; if (!subscription) throw new ApiError(404, "NOT_FOUND", "활성 구독이 없습니다.");
    const data = { ...subscription.data, cancelAtPeriodEnd: true }; await store.update("subscription", subscription.id, { data }); res.json({ data: { id: subscription.id, ...data } });
  }));

  // 역할/사용 시점: 주문 전 장바구니 상품별 구독자 가격과 총 결제 예정 금액을 계산해 보여 준다.
  router.get("/cart", memberAuth, asyncRoute(async (req, res) => {
    const records = await store.find<CartData>("cartItem", { ownerId: req.auth!.userId });
    const items = await Promise.all(records.map(async (item) => { const product = productById(item.data.productId)!; const price = await unitPrice(store, req.auth!.userId!, product.id); return { itemId: item.id, ...item.data, product: { ...product, appliedPrice: price }, subtotal: price * item.data.quantity }; }));
    res.json({ data: { items, total: items.reduce((sum, item) => sum + item.subtotal, 0), currency: "KRW" } });
  }));
  // 역할/사용 시점: 실물 제작 상품, 연결 동화, 수량과 선택 옵션을 장바구니에 추가한다.
  router.post("/cart/items", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10), storyId: z.string().uuid().optional(), options: z.record(z.string(), z.unknown()).optional() }), req.body);
    if (!productById(body.productId)) throw new ApiError(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
    if (body.storyId) { const story = await store.get("story", body.storyId); assertOwner(story, req.auth); }
    const record = await store.create<CartData>("cartItem", { ownerId: req.auth!.userId, relationId: body.storyId, lookup1: body.productId, status: "ACTIVE", data: body }); res.status(201).json({ data: { itemId: record.id, ...record.data } });
  }));
  // 역할/사용 시점: 주문하기 전 장바구니 항목의 수량이나 표지 문구 같은 옵션을 변경한다.
  router.patch("/cart/items/:itemId", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ quantity: z.number().int().min(1).max(10).optional(), options: z.record(z.string(), z.unknown()).optional() }).refine((value) => Object.keys(value).length > 0), req.body);
    const item = await store.get<CartData>("cartItem", routeParam(req.params.itemId)); assertOwner(item, req.auth); const updated = await store.update<CartData>("cartItem", item.id, { data: { ...item.data, ...body } }); res.json({ data: { itemId: item.id, ...updated!.data } });
  }));
  // 역할/사용 시점: 사용자가 구매하지 않을 상품을 자신의 장바구니에서 제거한다.
  router.delete("/cart/items/:itemId", memberAuth, asyncRoute(async (req, res) => { const item = await store.get("cartItem", routeParam(req.params.itemId)); assertOwner(item, req.auth); await store.delete("cartItem", item.id); res.status(204).end(); }));

  // 역할/사용 시점: 요청 상품 또는 장바구니를 기준으로 결제 금액을 확정하고 주문을 완료 처리한다.
  router.post("/orders", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10), storyId: z.string().uuid().optional(), options: z.record(z.string(), z.unknown()).optional() })).optional(), shipping: z.record(z.string(), z.unknown()).optional(), giftMessage: z.string().max(500).optional() }), req.body);
    let requested = body.items; const cart = await store.find<CartData>("cartItem", { ownerId: req.auth!.userId }); if (!requested?.length) requested = cart.map((item) => item.data);
    if (!requested?.length) throw new ApiError(400, "VALIDATION_FAILED", "주문할 상품이 없습니다.");
    const items: OrderData["items"] = [];
    for (const item of requested) { const price = await unitPrice(store, req.auth!.userId!, item.productId); if (item.storyId) { const story = await store.get("story", item.storyId); assertOwner(story, req.auth); } items.push({ ...item, amount: price * item.quantity }); }
    const amount = items.reduce((sum, item) => sum + item.amount, 0); const data: OrderData = { items, amount, paymentStatus: "PAID", orderStatus: "COMPLETED", shipping: body.shipping, giftMessage: body.giftMessage, carrier: null, trackingNumber: null, trackingUrl: null };
    const order = await store.create<OrderData>("order", { ownerId: req.auth!.userId, status: "COMPLETED", data }); for (const item of cart) await store.delete("cartItem", item.id);
    res.status(201).json({ data: { orderId: order.id, ...data, createdAt: order.createdAt.toISOString() } });
  }));
  // 역할/사용 시점: 마이페이지 주문 내역에서 로그인 회원의 주문을 페이지 단위로 조회한다.
  router.get("/orders", memberAuth, asyncRoute(async (req, res) => { const { page, pageSize } = parse(paginationSchema, req.query); const orders = await store.find<OrderData>("order", { ownerId: req.auth!.userId }); res.json(paginate(orders.map((item) => ({ orderId: item.id, ...item.data, createdAt: item.createdAt.toISOString() })), page, pageSize)); }));
  // 역할/사용 시점: 주문 완료·상세 화면에서 한 주문의 상품, 결제 및 배송 정보를 조회한다.
  router.get("/orders/:orderId", memberAuth, asyncRoute(async (req, res) => { const order = await store.get<OrderData>("order", routeParam(req.params.orderId)); assertOwner(order, req.auth); res.json({ data: { orderId: order.id, ...order.data, createdAt: order.createdAt.toISOString() } }); }));

  // 역할/사용 시점: 완료된 주문을 다른 사람에게 전달할 수 있도록 만료되는 선물 코드를 발급한다.
  router.post("/gifts", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ orderId: z.string().uuid(), message: z.string().max(500).optional() }), req.body); const order = await store.get<OrderData>("order", body.orderId); assertOwner(order, req.auth); if (order.status !== "COMPLETED") throw new ApiError(409, "CONFLICT", "완료된 주문만 선물할 수 있습니다.");
    const code = randomToken(18); const expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString(); const gift = await store.create<GiftData>("gift", { ownerId: req.auth!.userId, relationId: order.id, lookup1: sha256(code), status: "ISSUED", data: { orderId: order.id, codeHash: sha256(code), message: body.message, status: "ISSUED", expiresAt } });
    res.status(201).json({ data: { giftId: gift.id, giftCode: code, status: "ISSUED", expiresAt } });
  }));
  // 역할/사용 시점: 선물 수신자가 로그인하지 않고도 코드 상태와 메시지, 만료일을 확인한다.
  router.get("/gifts/:giftCode", asyncRoute(async (req, res) => { const gift = (await store.find<GiftData>("gift", { lookup1: sha256(routeParam(req.params.giftCode)) }))[0]; if (!gift) throw new ApiError(404, "NOT_FOUND", "선물 코드를 찾을 수 없습니다."); const status = new Date(gift.data.expiresAt).getTime() < Date.now() ? "EXPIRED" : gift.status; res.json({ data: { giftId: gift.id, status, message: gift.data.message, expiresAt: gift.data.expiresAt } }); }));

  // 역할/사용 시점: 회원·게스트가 자신이 만든 동화의 부적절한 내용을 운영 검토 대상으로 신고한다.
  router.post("/reports", anyAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ draftId: z.string().uuid().optional(), storyId: z.string().uuid().optional(), category: z.string().trim().min(1).max(50), description: z.string().trim().min(1).max(2000) }).refine((value) => Boolean(value.draftId) !== Boolean(value.storyId), { message: "draftId 또는 storyId 중 하나만 필요합니다." }), req.body);
    const kind = body.draftId ? "storyDraft" : "story"; const target = await store.get(kind, (body.draftId ?? body.storyId)!); assertOwner(target, req.auth);
    const report = await store.create("report", { ownerId: req.auth!.userId, guestId: req.auth!.guestSessionId, relationId: target.id, status: "RECEIVED", data: { ...body, status: "RECEIVED" } }); res.status(201).json({ data: { reportId: report.id, status: "RECEIVED" } });
  }));
  // 역할/사용 시점: 유치원·어린이집 등 기관 담당자의 대량 도입 상담과 개인정보 동의를 접수한다.
  router.post("/b2b/inquiries", asyncRoute(async (req, res) => {
    const body = parse(z.object({ organizationName: z.string().trim().min(1).max(100), contactName: z.string().trim().min(1).max(50), email: z.string().email(), phone: z.string().max(30), organizationType: z.string().max(50), estimatedVolume: z.number().int().nonnegative(), message: z.string().max(2000), privacyConsent: z.literal(true) }), req.body);
    const inquiry = await store.create("b2bInquiry", { lookup1: body.email.toLowerCase(), status: "RECEIVED", data: { ...body, email: body.email.toLowerCase(), status: "RECEIVED" } }); res.status(202).json({ data: { inquiryId: inquiry.id, message: "문의가 접수되었습니다." } });
  }));

  // 역할/사용 시점: 개인정보 열람 요청에 대응해 회원 관련 데이터를 비동기 JSON 파일로 만들어 제공한다.
  router.post("/me/data-export", memberAuth, asyncRoute(async (req, res) => {
    const existing = (await store.find<ExportData>("dataExport", { ownerId: req.auth!.userId }))[0];
    if (existing?.status === "READY" && existing.data.fileId && existing.data.expiresAt && new Date(existing.data.expiresAt).getTime() > Date.now()) { res.status(202).json({ data: { exportId: existing.id, status: "READY", downloadUrl: files.sign(existing.data.fileId, 86400), expiresAt: existing.data.expiresAt } }); return; }
    if (existing?.status === "QUEUED") { res.status(202).json({ data: { exportId: existing.id, status: "QUEUED" } }); return; }
    const userId = req.auth!.userId!;
    const record = await store.create<ExportData>("dataExport", { ownerId: userId, status: "QUEUED", data: { status: "QUEUED" } });
    queueMicrotask(async () => {
      try {
        const exportData: Record<string, unknown> = {};
        for (const kind of ["user", "consent", "child", "personalityAssessment", "storyDraft", "story", "order"] as const) exportData[kind] = await store.find(kind, { ownerId: userId });
        exportData.user = (exportData.user as Array<{ data: Record<string, unknown> }>).map((item) => { const { passwordHash: _, ...data } = item.data; return { ...item, data }; });
        const file = await files.save(Buffer.from(JSON.stringify(exportData, null, 2)), "application/json", "DATA_EXPORT", userId);
        const expiresAt = new Date(Date.now() + 86400_000).toISOString();
        await store.update("dataExport", record.id, { status: "READY", data: { status: "READY", fileId: file.id, expiresAt } });
      } catch {
        await store.update("dataExport", record.id, { status: "FAILED", data: { status: "FAILED", errorCode: "EXPORT_FAILED" } });
      }
    });
    res.status(202).json({ data: { exportId: record.id, status: "QUEUED" } });
  }));

  return router;
}
