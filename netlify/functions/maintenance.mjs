import { STORES } from "../lib/constants.mjs";
import { deleteJSON, listJSON, setJSON } from "../lib/storage.mjs";

export default async () => {
  const now = Date.now();
  let expiredSessions = 0;
  let expiredPairings = 0;
  let expiredJobs = 0;

  for (const { key, value } of await listJSON(STORES.auth, "sessions/")) {
    if (Date.parse(value.expiresAt) <= now) {
      await deleteJSON(STORES.auth, key);
      expiredSessions += 1;
    }
  }
  for (const { key, value } of await listJSON(STORES.data, "pairings/")) {
    if (Date.parse(value.expiresAt) <= now && !value.usedAt) {
      await deleteJSON(STORES.data, key);
      expiredPairings += 1;
    }
  }
  for (const { key, value } of await listJSON(STORES.data, "jobs/")) {
    if (Date.parse(value.expiresAt) <= now && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(value.status)) {
      value.status = "EXPIRED";
      value.updatedAt = new Date().toISOString();
      await setJSON(STORES.data, key, value);
      expiredJobs += 1;
    }
  }
  console.log(JSON.stringify({ expiredSessions, expiredPairings, expiredJobs, at: new Date().toISOString() }));
};

export const config = {
  schedule: "*/15 * * * *",
};
