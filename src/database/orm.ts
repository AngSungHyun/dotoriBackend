import { MikroORM, RequestContext } from "@mikro-orm/mysql";
import { Migrator } from "@mikro-orm/migrations";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { entities } from "./entities.js";

let orm: MikroORM | undefined;

export async function initOrm(): Promise<MikroORM> {
  orm = await MikroORM.init({
    entities,
    clientUrl: config.DATABASE_URL,
    debug: false,
    allowGlobalContext: false,
    extensions: [Migrator],
    migrations: { path: "dist/database/migrations", pathTs: "src/database/migrations" },
  });
  if (config.DB_AUTO_SYNC) await orm.schema.updateSchema();
  return orm;
}

export function getOrm(): MikroORM {
  if (!orm) throw new Error("ORM이 초기화되지 않았습니다.");
  return orm;
}

export function ormRequestContext(_req: Request, _res: Response, next: NextFunction): void {
  RequestContext.create(getOrm().em, next);
}

export async function closeOrm(): Promise<void> {
  if (orm) await orm.close(true);
  orm = undefined;
}
