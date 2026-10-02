// supabase/functions/normal-terminal/index.ts
var headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  return new Response(
    JSON.stringify({ error: "Reload the app and complete the game through live actions." }),
    { status: 409, headers }
  );
});
