import React, { useState } from "react";
import { setAdminToken } from "../auth/authToken";


type LoginUser = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "teacher";
};

export default function Login({ onSuccess }: { onSuccess: (user: LoginUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function login() {
    setMsg("");

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      setMsg("Login failed");
      return;
    }

    const data = await res.json(); // { access_token, token_type }
    setAdminToken(data.access_token);
    setMsg("Logged in");
    onSuccess(data.user);

    // 라우팅 쓰면 여기서 이동 처리:
    // navigate("/admin");
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: 16 }}>
      <h2>Admin Login</h2>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        ID
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>

      <button className="btn" onClick={login}>Login</button>

      {msg && <div style={{ marginTop: 10, color: "#666" }}>{msg}</div>}
    </div>
  );
}
