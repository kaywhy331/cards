import { STORES } from "../lib/constants.mjs";
import { hashPassword, randomId } from "../lib/crypto.mjs";
import { deleteJSON, getJSON, listJSON, setJSON, storageBackendName } from "../lib/storage.mjs";

const DIAGNOSTIC_KEY = "ezcards-bootstrap-primitives-v1";

export default async (req, context) => {
  const deployContext = context?.deploy?.context || process.env.CONTEXT || "unknown";
  if (deployContext === "production") {
    return Response.json({ ok: false, error: "Unavailable in production." }, { status: 404 });
  }
  if (req.headers.get("x-diagnostic-key") !== DIAGNOSTIC_KEY) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const prefix = `bootstrap-diagnostic/${Date.now()}-${randomId("run")}`;
  const stages = [];
  try {
    stages.push("start");
    const claim = await setJSON(STORES.tests, `${prefix}/claim`, { createdAt: new Date().toISOString() }, { onlyIfNew: true });
    stages.push({ claim });

    const encoded = await hashPassword("diagnostic-password-123");
    stages.push({ passwordHash: encoded.startsWith("scrypt$") });

    const pointer = await setJSON(STORES.tests, `${prefix}/email-pointer`, { userId: "diagnostic-user" }, { onlyIfNew: true });
    stages.push({ pointer });

    await setJSON(STORES.tests, `${prefix}/user`, {
      id: "diagnostic-user",
      email: "diagnostic@example.invalid",
      passwordHash: encoded,
      createdAt: new Date().toISOString(),
    });
    stages.push("user-write");

    const readBack = await getJSON(STORES.tests, `${prefix}/user`);
    stages.push({ readBack: Boolean(readBack?.passwordHash) });

    const listed = await listJSON(STORES.tests, prefix);
    stages.push({ listed: listed.length });

    return Response.json({ ok: true, deployContext, storage: storageBackendName(), stages });
  } catch (error) {
    return Response.json({
      ok: false,
      deployContext,
      storage: storageBackendName(),
      stages,
      error: error?.message || String(error),
      name: error?.name || "Error",
      stack: error?.stack || null,
    }, { status: 500 });
  } finally {
    for (const suffix of ["claim", "email-pointer", "user"]) {
      try { await deleteJSON(STORES.tests, `${prefix}/${suffix}`); } catch {}
    }
  }
};

export const config = {
  path: "/diagnostic/bootstrap-primitives",
};
