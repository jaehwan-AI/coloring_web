// frontend/src/pages/AdminMembers.tsx
import React, { useEffect, useState } from "react";
import { getAdminToken } from "../auth/authToken";


type Teacher = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "teacher";
  is_active?: boolean;
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

type TeacherEditForm = {
  username: string;
  display_name: string;
  is_active: boolean;
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
  const [editingTeacherId, setEditingTeacherId] = useState<number | null>(null);
  const [editTeacherForm, setEditTeacherForm] = useState<TeacherEditForm>({
    username: "",
    display_name: "",
    is_active: true,
  });
  const [resetPasswordMap, setResetPasswordMap] = useState<Record<number, string>>({});

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

  function startEditTeacher(t: Teacher) {
    setEditingTeacherId(t.id);
    setEditTeacherForm({
      username: t.username,
      display_name: t.display_name,
      is_active: t.is_active ?? true,
    });
  }

  function cancelEditTeacher() {
    setEditingTeacherId(null);
    setEditTeacherForm({
      username: "",
      display_name: "",
      is_active: true,
    });
  }

  async function saveTeacher(teacherId: number) {
    const token = getAdminToken();
    setError("");

    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}`, {
        method: "PUT",
        headers: {
          "content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(editTeacherForm),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "선생님 수정 실패");
      }

      cancelEditTeacher();
      await loadTeachers();
    } catch (e: any) {
      setError(e?.message || "선생님 수정 실패");
    }
  }

  async function resetTeacherPassword(teacherId: number) {
    const token = getAdminToken();
    const password = (resetPasswordMap[teacherId] || "").trim();
    setError();

    if (!password) {
      setError("새 비밀번호를 입력하세요.");
      return;
    }

    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "비밀번호 재설정 실패");
      }

      setResetPasswordMap((prev) => ({ ...prev, [teacherId]: "" }));
      alert("비밀번호가 재설정되었습니다.");
    } catch (e: any) {
      setError(e?.message || "비밀번호 재설정 실패");
    }
  }

  async function deleteTeacher(teacherId: number) {
    const token = getAdminToken();
    setError("");

    const ok = window.confirm("정말 이 선생님 계정을 삭제하시겠습니까?");
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "선생님 삭제 실패");
      }

      await loadTeachers();
      await loadMembers();
    } catch (e: any) {
      setError(e?.message || "선생님 삭제 실패");
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
    <>
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
                <th>Active</th>
                <th>Edit</th>
                <th>Password Reset</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>
                    {editingTeacherId === t.id ? (
                      <input
                        className="textInput"
                        value={editTeacherForm.username}
                        onChange={(e) =>
                          setEditTeacherForm((prev) => ({
                            ...prev,
                            username: e.target.value,
                          }))
                        }
                      />
                    ) : (
                      t.username
                    )}
                  </td>
                  <td>
                    {editingTeacherId === t.id ? (
                      <input
                        className="textInput"
                        value={editTeacherForm.display_name}
                        onChange={(e) => 
                          setEditTeacherForm((prev) => ({
                            ...prev,
                            display_name: e.target.value,
                          }))
                        }
                      />
                    ) : (
                      t.display_name
                    )}
                  </td>
                  <td>{t.role}</td>
                <td>
                  {editingTeacherId === t.id ? (
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={editTeacherForm.is_active}
                        onChange={(e) =>
                          setEditTeacherForm((prev) => ({
                            ...prev,
                            is_active: e.target.checked,
                          }))
                        }
                      />
                      active
                    </label>
                  ) : t.is_active === false ? (
                    "N"
                  ) : (
                    "Y"
                  )}
                </td>
                <td>
                  {editingTeacherId === t.id ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" onClick={() => saveTeacher(t.id)}>
                        Save
                      </button>
                      <button className="btn btnGhost" onClick={cancelEditTeacher}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => startEditTeacher(t)}>
                      Edit
                    </button>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="textInput"
                      type="password"
                      placeholder="new password"
                      value={resetPasswordMap[t.id] || ""}
                      onChange={(e) =>
                        setResetPasswordMap((prev) => ({
                          ...prev,
                          [t.id]: e.target.value,
                        }))
                      }
                    />
                    <button className="btn" onClick={() => resetTeacherPassword(t.id)}>
                      Reset
                    </button>
                  </div>
                </td>
                <td>
                  <button className="btn btnDanger" onClick={() => deleteTeacher(t.id)}>
                    Delete
                  </button>
                </td>
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
    </>
  );
}