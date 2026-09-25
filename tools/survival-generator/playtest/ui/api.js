// The browser's only door to the game: the local playtest API. It returns the
// player's view and nothing else.
async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `${response.status} ${response.statusText}`);
  return data;
}

export const api = {
  levels: () => call("GET", "/api/levels"),
  start: (levelId) => call("POST", "/api/attempts", { levelId }),
  attempt: (attemptId) => call("GET", `/api/attempts/${attemptId}`),
  move: (attemptId, move) => call("POST", `/api/attempts/${attemptId}/move`, { move }),
  authur: (attemptId) => call("POST", `/api/attempts/${attemptId}/authur`),
};
