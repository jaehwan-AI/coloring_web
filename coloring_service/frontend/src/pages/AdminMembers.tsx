// frontend/src/pages/AdminMembers.tsx
import { getAdminToken } from "../auth/adminToken";

async function loadMembers() {
  const token = getAdminToken();

  const res = await fetch("/api/admin/members", {
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : {},
  });

  const data = await res.json();
  // ...
}
