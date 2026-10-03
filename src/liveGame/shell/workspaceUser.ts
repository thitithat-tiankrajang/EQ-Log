import { useAuth } from "../../auth";

/** The account the private workspace belongs to; isolated renders have no provider. */
export function useWorkspaceUser(): string {
  let userId: string | null | undefined = null;
  try {
    // Called unconditionally, once per render: the try only catches the
    // "outside <AuthProvider>" throw, so hook order never changes.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    userId = useAuth().userId;
  } catch {
    // Outside <AuthProvider> (component tests, development sources).
  }
  return userId || "anonymous";
}
