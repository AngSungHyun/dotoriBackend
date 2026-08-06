import { Router } from "express";
import { z } from "zod";
import { billingPlans, illustrationStyles, products, tags, worlds } from "../domain/catalog.js";
import { asyncRoute, ApiError, parse } from "../lib/errors.js";
import { routeParam } from "../lib/http.js";

export function catalogRouter(): Router {
  const router = Router();
  // 역할/사용 시점: 동화 제작의 배경 선택 화면에서 연령별 세계관 목록을 보여 준다.
  router.get("/catalog/worlds", (_req, res) => res.json({ data: worlds.map((world) => ({ ...world, thumbnailUrl: null })) }));
  // 역할/사용 시점: 세계관 선택 상세에서 설명과 호환 교훈·분위기를 확인한다.
  router.get("/catalog/worlds/:id", (req, res, next) => { const world = worlds.find((item) => item.id === routeParam(req.params.id)); if (!world) return next(new ApiError(404, "NOT_FOUND", "세계관을 찾을 수 없습니다.")); res.json({ data: { ...world, thumbnailUrl: null } }); });
  // 역할/사용 시점: 동화 삽화 생성 전에 사용자가 선택할 공개 그림체 정보를 제공한다.
  router.get("/catalog/illustration-styles", (_req, res) => res.json({ data: illustrationStyles.map(({ prompt: _, ...style }) => style) }));
  // 역할/사용 시점: 관심사·감정·상황·교훈·톤·제외 조건을 전체 또는 그룹별로 조회한다.
  router.get("/catalog/tags", asyncRoute(async (req, res) => { const { group } = parse(z.object({ group: z.enum(["INTEREST", "EMOTION", "SITUATION", "LESSON", "TONE", "NEGATIVE"]).optional() }), req.query); res.json({ data: group ? tags.filter((tag) => tag.group === group) : tags }); }));
  // 역할/사용 시점: 구독·동화 결제 화면에서 가격과 제공량을 표시한다.
  router.get("/billing/plans", (_req, res) => res.json({ data: billingPlans }));
  // 역할/사용 시점: 장바구니에서 구매 가능한 양장본·선물 패키지·키링 상품을 표시한다.
  router.get("/products", (_req, res) => res.json({ data: products }));
  return router;
}
