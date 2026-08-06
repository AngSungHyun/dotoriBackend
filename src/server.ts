import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeOrm, initOrm, ormRequestContext } from "./database/orm.js";
import { FileService } from "./services/file-service.js";
import { GenerationQueue } from "./services/generation-queue.js";
import { OpenAiService, UnavailableAiService } from "./services/openai.js";
import { OrmStore } from "./store/store.js";

const orm = await initOrm();
const store = new OrmStore(orm.em);
const files = new FileService(store);
await files.initialize();
const ai = config.CHATGPT_API_KEY ? new OpenAiService() : new UnavailableAiService();
const queue = new GenerationQueue(store, ai, files);
await queue.recoverInterruptedJobs();
const app = createApp({ store, files, ai, queue }, ormRequestContext);

const server = app.listen(config.PORT, () => console.log(`Dotori API listening on http://localhost:${config.PORT}`));
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received; shutting down.`);
  server.close(async () => { await closeOrm(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
