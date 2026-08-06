import type { EntityManager } from "@mikro-orm/mysql";
import { describe, expect, it, vi } from "vitest";
import { OrmStore } from "./store.js";

describe("OrmStore", () => {
  it("forks the root EntityManager when called outside a request context", async () => {
    const repository = { find: vi.fn().mockResolvedValue([]) };
    const forkedEm = { getRepository: vi.fn().mockReturnValue(repository) };
    const rootEm = { fork: vi.fn().mockReturnValue(forkedEm) };
    const store = new OrmStore(rootEm as unknown as EntityManager);

    await expect(store.find("generationJob", { status: "QUEUED" })).resolves.toEqual([]);

    expect(rootEm.fork).toHaveBeenCalledOnce();
    expect(repository.find).toHaveBeenCalledOnce();
  });
});
