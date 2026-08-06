import { initOrm, closeOrm } from "./orm.js";

const orm = await initOrm();
try {
  await orm.migrator.up();
  console.log("Database migrations are up to date.");
} finally {
  await closeOrm();
}
