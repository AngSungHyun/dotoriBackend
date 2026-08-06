import type { Store } from "./domain/types.js";
import type { GenerationQueue } from "./services/generation-queue.js";
import type { FileService } from "./services/file-service.js";
import type { AiService } from "./services/openai.js";

export interface AppContext {
  store: Store;
  files: FileService;
  ai: AiService;
  queue: GenerationQueue;
}

