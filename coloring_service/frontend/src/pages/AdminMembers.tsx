// frontend/src/pages/AdminMembers.tsx
import React, { useEffect, useState } from "react";
import { getAdminToken } from "../auth/authToken";


type Teacher = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "teacher";
};

type MemberRow = {
  id: number;
  number: string;
  name: string;
  birth_date?: string | null;
  memo?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  teacher_id?: number | null;
  teacher_name?: string | null;
};

type TeacherCreateForm = {
  username: string;
  password: string;
  display_name: string;
};

export default function AdminMembers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState("");

  const [teacherForm, setTeacherForm] = useState<TeacherCreateForm>({
    username: "",
    password: "",
    display_name: "",
  });

  async function loadTeachers() {
    const token = getAdminToken();
    setLoadingTeachers(true);
    setError("");

    try {
      const res = await fetch("/api/admin/teachers", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error("선생님 목록을 불러오지 못했습니다.");
      }

      const data = (await res.json()) as Teacher[];
      setTeachers(data);
    } catch (e: any) {
      setError(e?.message || "선생님 목록 조회 실패");
    } finally {
      setLoadingTeachers(false);
    }
  }

  async function loadMembers() {
    const token = getAdminToken();
    setLoadingMembers(true);
    setError("");

    try {
      const res = await fetch("/api/members", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error("회원 목록을 불러오지 못했습니다.");
      }

      const data = (await res.json()) as MemberRow[];
      setMembers(data);
    } catch (e: any) {
      setError(e?.message || "회원 목록 조회 실패");
    } finally {
      setLoadingMembers(false);
    }
  }

  async function createTeacher() {
    const token = getAdminToken();
    setError("");

    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(teacherForm),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "선생님 생성 실패");
      }

      setTeacherForm({
        username: "",
        password: "",
        display_name: "",
      });

      await loadTeachers();
    } catch (e: any) {
      setError(e?.message || "선생님 생성 실패");
    }
  }

  async function assignTeacherToMember(memberId: number, teacherId: number) {
    const token = getAdminToken();
    setError("");

    try {
      const res = await fetch(`/api/admin/members/${memberId}/teacher`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ teacher_id: teacherId }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "담당 선생님 변경 실패");
      }

      await loadMembers();
    } catch (e: any) {
      setError(e?.message || "담당 선생님 변경 실패");
    }
  }

  useEffect(() => {
    loadTeachers();
    loadMembers();
  }, []);

  return (
    {error ? <div style={{ color: "crimson", marginBottom: 12 }}>{error}</div> : null}
    <div className="panelCard" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 900, marginBottom: 12 }}>Teachers</div>

      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <input
          className="textInput"
          placeholder="username"
          value={teacherForm.username}
          onChange={(e) =>
            setTeacherForm((prev) => ({ ...prev, username: e.target.value }))
          }
        />
        <input
          className="textInput"
          placeholder="display name"
          value={teacherForm.display_name}
          onChange={(e) =>
            setTeacherForm((prev) => ({ ...prev, display_name: e.target.value }))
          }
        />
        <input
          className="textInput"
          type="password"
          placeholder="password"
          value={teacherForm.password}
          onChange={(e) =>
            setTeacherForm((prev) => ({ ...prev, password: e.target.value }))
          }
        />
        <button className="btn" onClick={createTeacher}>
          Create Teacher
        </button>
      </div>

      {loadingTeachers ? (
        <div>Loading teachers...</div>
      ) : (
        <table className="memberTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Name</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.username}</td>
                <td>{t.display_name}</td>
                <td>{t.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    <div className="panelCard">
      <div style={{ fontWeight: 900, marginBottom: 12 }}>Members</div>

      {loadingMembers ? (
        <div>Loading members...</div>
      ) : (
        <table className="memberTable">
          <thead>
            <tr>
              <th>번호</th>
              <th>이름</th>
              <th>생년월일</th>
              <th>키</th>
              <th>몸무게</th>
              <th>담당 선생님</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.number}</td>
                <td>{m.name}</td>
                <td>{m.birth_date ?? "-"}</td>
                <td>{m.height_cm ?? "-"}</td>
                <td>{m.weight_kg ?? "-"}</td>
                <td>
                  <select
                    value={m.teacher_id ?? ""}
                    onChange={(e) => assignTeacherToMember(m.id, Number(e.target.value))}
                  >
                    <option value="">선생님 선택</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.display_name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}