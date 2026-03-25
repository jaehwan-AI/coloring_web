// MemberRegister.tsx
import React, { useEffect, useState } from "react";
import { getAdminToken } from "../auth/authToken";

type CurrentUser = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "teacher";
};

type TeacherOption = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "teacher";
};

type MemberForm = {
  number: string;
  name: string;
  birth_date?: string | null;
  memo?: string;
  height_cm?: number | null;
  weight_kg?: number | null;
  teacher_id?: number | null;
  course_name?: string | null;
  contract_status?: string | null;
  contract_start_date?: string | null;
  contract_end_date?: string | null;
  contract_signed_at?: string | null;
  contract_memo?: string | null;
};

const COURSE_OPTIONS = [
  "10 PT",
  "20 PT",
  "30 PT",
  "Pilates Basic",
  "Pilates Premium",
  "Rehab",
];

export default function MemberRegister({
  currentUser,
}: {
  currentUser: CurrentUser;
}) {
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<MemberForm>({
    number: "",
    name: "",
    birth_date: "",
    memo: "",
    height_cm: null,
    weight_kg: null,
    teacher_id: currentUser.role === "teacher" ? currentUser.id : null,
    course_name: "",
    contract_status: "draft",
    contract_start_date: "",
    contract_end_date: "",
    contract_signed_at: "",
    contract_memo: "",
  });

  useEffect(() => {
    if (currentUser.role !== "admin") return;
    const token = getAdminToken();
    fetch("/api/admin/teachers", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((data) => setTeachers(Array.isArray(data) ? data : []))
      .catch(() => setTeachers([]));
  }, [currentUser]);

  async function loadByNumber() {
    const token = getAdminToken();
    if (!form.number.trim()) {
      setMsg("회원 번호를 입력하세요.");
      return;
    }

    try {
      const res = await fetch(`/api/members/by-number/${encodeURIComponent(form.number.trim())}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        setMsg("기존 회원이 없으면 그대로 신규 등록하면 됩니다.");
        return;
      }

      const data = await res.json();
      setForm({
        number: data.number ?? "",
        name: data.name ?? "",
        birth_date: data.birth_date ?? "",
        memo: data.memo ?? "",
        height_cm: data.height_cm ?? null,
        weight_kg: data.weight_kg ?? null,
        teacher_id: data.teacher_id ?? null,
        course_name: data.course_name ?? "",
        contract_status: data.contract_status ?? "draft",
        contract_start_date: data.contract_start_date ?? "",
        contract_end_date: data.contract_end_date ?? "",
        contract_signed_at: data.contract_signed_at
          ? String(data.contract_signed_at).slice(0, 16)
          : "",
        contract_memo: data.contract_memo ?? "",
      });
      setMsg("회원 정보를 불러왔습니다.");
    } catch {
      setMsg("네트워크 오류");
    }
  }

  async function saveMember() {
    const token = getAdminToken();

    if (!form.number.trim() || !form.name.trim()) {
      setMsg("회원 번호와 이름은 필수입니다.");
      return;
    }

    if (currentUser.role === "admin" && !form.teacher_id) {
      setMsg("관리자는 담당 선생님을 선택해야 합니다.");
      return;
    }

    setSaving(true);
    setMsg("");

    try {
      const res = await fetch("/api/members/upsert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          number: form.number.trim(),
          name: form.name.trim(),
          birth_date: form.birth_date || null,
          memo: form.memo || "",
          height_cm: form.height_cm ?? null,
          weight_kg: form.weight_kg ?? null,
          teacher_id: currentUser.role === "admin" ? form.teacher_id : undefined,
          course_name: form.course_name || null,
          contract_status: form.contract_status || "draft",
          contract_start_date: form.contract_start_date || null,
          contract_end_date: form.contract_end_date || null,
          contract_signed_at: form.contract_signed_at || null,
          contract_memo: form.contract_memo || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setMsg(text || "회원 저장 실패");
        return;
      }

      setMsg("회원/계약 정보가 저장되었습니다.");
    } catch {
      setMsg("네트워크 오류");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="registerPage">
      <div className="registerLayout">
        <section className="panelCard">
          <h3 style={{ marginTop: 0 }}>Member Register</h3>

          <div className="memberRow">
            <label style={{ flex: 1 }}>
              회원 번호
              <input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="예: 100023"
              />
            </label>
            <button className="btn" onClick={loadByNumber}>불러오기</button>
          </div>

          <label>
            이름
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label>
            생년월일
            <input
              type="date"
              value={form.birth_date ?? ""}
              onChange={(e) => setForm({ ...form, birth_date: e.target.value || "" })}
            />
          </label>

          <label>
            키(cm)
            <input
              type="number"
              step="0.1"
              value={form.height_cm ?? ""}
              onChange={(e) =>
                setForm({ ...form, height_cm: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>

          <label>
            몸무게(kg)
            <input
              type="number"
              step="0.1"
              value={form.weight_kg ?? ""}
              onChange={(e) =>
                setForm({ ...form, weight_kg: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>

          {currentUser.role === "admin" ? (
            <label>
              담당 선생님
              <select
                value={form.teacher_id ?? ""}
                onChange={(e) =>
                  setForm({ ...form, teacher_id: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">선택</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            메모
            <textarea
              rows={4}
              value={form.memo ?? ""}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </label>
        </section>

        <section className="panelCard">
          <h3 style={{ marginTop: 0 }}>Course / Contract</h3>

          <label>
            코스 선택
            <select
              value={form.course_name ?? ""}
              onChange={(e) => setForm({ ...form, course_name: e.target.value })}
            >
              <option value="">선택</option>
              {COURSE_OPTIONS.map((course) => (
                <option key={course} value={course}>
                  {course}
                </option>
              ))}
            </select>
          </label>

          <label>
            계약 상태
            <select
              value={form.contract_status ?? "draft"}
              onChange={(e) => setForm({ ...form, contract_status: e.target.value })}
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="expired">expired</option>
              <option value="terminated">terminated</option>
            </select>
          </label>

          <label>
            계약 시작일
            <input
              type="date"
              value={form.contract_start_date ?? ""}
              onChange={(e) => setForm({ ...form, contract_start_date: e.target.value || "" })}
            />
          </label>

          <label>
            계약 종료일
            <input
              type="date"
              value={form.contract_end_date ?? ""}
              onChange={(e) => setForm({ ...form, contract_end_date: e.target.value || "" })}
            />
          </label>

          <label>
            계약 작성 일시
            <input
              type="datetime-local"
              value={form.contract_signed_at ?? ""}
              onChange={(e) => setForm({ ...form, contract_signed_at: e.target.value || "" })}
            />
          </label>

          <label>
            계약 메모
            <textarea
              rows={5}
              value={form.contract_memo ?? ""}
              onChange={(e) => setForm({ ...form, contract_memo: e.target.value })}
            />
          </label>

          <button className="btn" onClick={saveMember} disabled={saving}>
            {saving ? "저장 중..." : "회원 저장"}
          </button>

          {msg ? <div style={{ marginTop: 10, color: "#666" }}>{msg}</div> : null}
        </section>
      </div>
    </div>
  );
}