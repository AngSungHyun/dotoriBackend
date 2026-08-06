import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import type { RequestHandler } from "express";
import { corsOrigins } from "./config.js";
import type { AppContext } from "./app-context.js";
import { errorHandler, notFound, asyncRoute } from "./lib/errors.js";
import { routeParam } from "./lib/http.js";
import { openApiDocument } from "./openapi.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { childrenRouter } from "./routes/children.js";
import { commerceRouter } from "./routes/commerce.js";
import { storiesRouter } from "./routes/stories.js";

export function createApp(context: AppContext, requestContext?: RequestHandler) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // 심사·프론트엔드 연동 시 브라우저에서 API 계약과 실행 예시를 확인하는 문서 화면이다.
  app.get("/api-docs.json", (_req, res) => res.json(openApiDocument));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: "도토리 API 문서",
    swaggerOptions: { persistAuthorization: true, withCredentials: true },
  }));

  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  if (requestContext) app.use(requestContext);

  const api = express.Router();
  // 서명 URL로만 접근 가능한 생성 이미지·내보내기 파일을 전달하는 API다.
  api.get("/files/:fileId", asyncRoute(async (req, res) => {
    const file = await context.files.readSigned(routeParam(req.params.fileId), req.query.expires, req.query.signature);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file.buffer);
  }));
  api.use(catalogRouter());
  api.use(authRouter(context.store, context.files));
  api.use(childrenRouter(context.store, context.files));
  api.use(storiesRouter(context.store, context.files, context.ai, context.queue));
  api.use(commerceRouter(context.store, context.files));
  app.use("/api/v1", api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
