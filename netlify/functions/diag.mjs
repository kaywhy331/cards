export default async (_req, context) => Response.json({
  ok: true,
  context: context?.deploy?.context || process.env.CONTEXT || "unknown",
  marker: "ezcards-preview-diagnostic",
});

export const config = {
  path: "/api/diag",
};
