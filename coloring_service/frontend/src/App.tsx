import React, { useEffect, useRef, useState } from "react";
import { COLORS, 
  estimateBackground, 
  buildBackgroundMask, 
  floodFillWithBgMask, type RGB } from "./coloring";
import AppShell from "./layout/AppShell";
import MyMember from "./pages/MyMember";
import SchedulePage from "./pages/Schedule";
import AdminLogin from "./pages/AdminLogin";
import { clearAdminToken, getAdminToken } from "./auth/adminToken";


const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

function toApiUrl(url?: string | null) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

type Color = "red" | "blue" | "restore";

type MemberInfo = {
  number: string;
  name: string;
  birth_date?: string | null;
  memo?: string;
  height_cm?: number | null;
  weight_kg?: number | null;
};

type EditingResultPayload = {
  id: number;
  url: string;
  note?: string | null;
  selected_date?: string | null;
  member: MemberInfo;
};

function drawImageContainShiftUp(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  shiftUpCssPx: number
) {
  const canvas = ctx.canvas;
  const cw = canvas.width;
  const ch = canvas.height;

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  // Keep the whole image visible even after shifting up:
  // reserve space by shrinking the available height by 2*shift.
  const safeH = Math.max(1, ch - 2 * shiftUpCssPx);
  const scale = Math.min(cw / iw, safeH / ih);

  const dw = iw * scale;
  const dh = ih * scale;

  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2 - shiftUpCssPx;

  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, dx, dy, dw, dh);
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [selected, setSelected] = useState<Color>("red");
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  const [bg, setBg] = useState<RGB>([255, 255, 255]);
  const [bgTol, setBgTol] = useState<number>(40);

  const originalRef = useRef<ImageData | null>(null);
  const undoRef = useRef<ImageData[]>([]);

  /** 현재 화면에 보이는(색칠 포함) 캔버스 상태 */
  const workingRef = useRef<ImageData | null>(null);

  const bgMaskRef = useRef<Uint8Array | null>(null);

  const [page, setPage] = useState<"color" | "member" | "schedule" | "admin">("admin");
  const [adminAuthed, setAdminAuthed] = useState(false);

  useEffect(() => {
    clearAdminToken();
    setAdminAuthed(false);
    setPage("admin");
  }, []);

  // ===== Member panel state =====
  const [member, setMember] = useState<MemberInfo>({ 
    number: "", 
    name: "", 
    birth_date: "",
    memo: "",
    height_cm: undefined,
    weight_kg: undefined, });
  const [memberMsg, setMemberMsg] = useState<string>("");
  const [loadingMember, setLoadingMember] = useState<boolean>(false);
  const [savingMember, setSavingMember] = useState<boolean>(false);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [resultNote, setResultNote] = useState("");

  const [editingResultId, setEditingResultId] = useState<number | null>(null);

  const hasImage = !!imgUrl;

  // ===== Upload =====
  async function onPickFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      alert("Upload failed");
      return;
    }
    const data = await res.json();
    setImgUrl(data.url);
  }

  // ===== Member Load (name) =====
  async function loadMemberByName() {
    const name = member.name.trim();
    if (!name) {
      setMemberMsg("Please enter member number.");
      return;
    }
    setLoadingMember(true);
    setMemberMsg("");
    try {
      // 1) Try direct endpoint (if exists)
      const res = await fetch(`/api/members/${encodeURIComponent(name)}`);
      if (!res.ok) {
        // 2) Fallback: search endpoint returning list (if exists)
        alert("Member not found.");
        return;
      }

      if (!res.ok) {
        setMemberMsg(res.status === 404 ? "Member not found." : "Failed to load member.");
        return;
      }
      
      const data = await res.json();

      // If using search endpoint: { items: [...] }
      const memberData = Array.isArray(data?.items) ? (data.items[0] ?? null) : data;
      if (!memberData) {
        setMemberMsg("Member not found.");
        return;
      }

      setMember({
        number: data.number ?? "",
        name: data.name ?? name,
        birth_date: data.birth_date ?? "",
        memo: data.memo ?? "",
        height_cm: data.height_cm ?? null,
        weight_kg: data.weight_kg ?? null,
      });
      setMemberMsg("Loaded.");
    } catch {
      setMemberMsg("Network error.");
    } finally {
      setLoadingMember(false);
    }
  }

  // ===== Member Save (DB) =====
  async function saveMemberToDB() {
    const number = member.number.trim();
    const name = member.name.trim();
    if (!number || !name) {
      setMemberMsg("Number and Name are required.");
      return;
    }
    setSavingMember(true);
    setMemberMsg("");
    try {
      const res = await fetch("/api/members/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number,
          name,
          birth_date: member.birth_date || null,
          memo: member.memo ?? "",
          height_cm: member.height_cm ?? null,
          weight_kg: member.weight_kg ?? null,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setMemberMsg(txt || "Failed to save member.");
        return;
      }

      setMemberMsg("Saved.");
    } catch {
      setMemberMsg("Network error.");
    } finally {
      setSavingMember(false);
    }
  }

  function cancelEditMode() {
    setEditingResultId(null);
    setResultNote("");
    setImgUrl(null);
  }

  async function saveColoredToDB() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const number = member.number?.trim();
    const name = member.name?.trim();
    if (!number || !name) {
      alert("Member Number and Name are required before saving result.");
      return;
    }

    const image_data_url = canvas.toDataURL("image/png");

    const payload = {
      member: {
        number,
        name,
        birth_date: member.birth_date || null,
        memo: member.memo ?? "",
        height_cm: member.height_cm ?? null,
        weight_kg: member.weight_kg ?? null,
      },
      image_data_url,
      selected_date: selectedDate || null,
      original_id: editingResultId,
      note: resultNote,
      original_upload_url: editingResultId ? null : imgUrl,
    };

    const isEditing = editingResultId !== null;
    const url = isEditing ? `/api/results/${editingResultId}` : "/api/results/save";
    const method = isEditing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      alert(t || (isEditing ? "Failed to update colored result." : "Failed to save colored result."));
      return;
    }

    setResultNote("");
    setEditingResultId(null);

    alert(isEditing ? "Updated colored result!" : "Saved colored result!");
  }

  function startEditResult(payload: EditingResultPayload) {
    const baseUrl = toApiUrl(payload.url);
    const nextUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;

    setEditingResultId(payload.id);

    setMember({
      number: payload.member.number ?? "",
      name: payload.member.name ?? "",
      birth_date: payload.member.birth_date ?? "",
      memo: payload.member.memo ?? "",
      height_cm: payload.member.height_cm ?? null,
      weight_kg: payload.member.weight_kg ?? null,
    });

    setSelectedDate(payload.selected_date ?? "");
    setResultNote(payload.note ?? "");

    // 같은 URL이어도 강제로 다시 로드되게 함
    setImgUrl(null);
    requestAnimationFrame(() => {
      setImgUrl(nextUrl);
    });

    setPage("color");
  }
  
  // ===== Canvas sizing: match CSS box (fixes click mapping & iPad issues) =====
  function sizeCanvasToCssBox() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function redrawFromImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prevWorking = workingRef.current;
    const prevOriginal = imgRef.current;

    if (!prevWorking && !prevOriginal) return;

    const oldW = prevWorking?.width ?? prevOriginal?.width ?? canvas.width;
    const oldH = prevWorking?.height ?? prevOriginal?.height ?? canvas.height;

    sizeCanvasToCssBox();

    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 현재 작업 상태 복원
    if (prevWorking) {
      const tmp = document.createElement("canvas");
      tmp.width = oldW;
      tmp.height = oldH;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.putImageData(prevWorking, 0, 0);

      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      workingRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    // Reset용 원본도 같은 방식으로 크기 맞춰 보관
    if (prevOriginal) {
      const tmpOriginal = document.createElement("canvas");
      tmpOriginal.width = prevOriginal.width;
      tmpOriginal.height = prevOriginal.height;
      const octx = tmpOriginal.getContext("2d", { willReadFrequently: true })!;
      octx.putImageData(prevOriginal, 0, 0);

      const originalCanvas = document.createElement("canvas");
      originalCanvas.width = canvas.width;
      originalCanvas.height = canvas.height;
      const oc = originalCanvas.getContext("2d", { willReadFrequently: true })!;
      oc.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
      oc.fillStyle = "#ffffff";
      oc.fillRect(0, 0, originalCanvas.width, originalCanvas.height);
      oc.drawImage(tmpOriginal, 0, 0, originalCanvas.width, originalCanvas.height);

      originalRef.current = oc.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    }

    const est = estimateBackground(ctx, canvas.width, canvas.height);
    setBg(est.bg);
    setBgTol(est.tol);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bgMaskRef.current = buildBackgroundMask(imgData, est.bg, est.tol);
  }

  // ===== Load & draw image =====
  useEffect(() => {
    if (!imgUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

      const SHIFT_UP = 10;          // “위로 10px 느낌”
      const PAD_BOTTOM = SHIFT_UP * 2; // 아래 여백(20px) → 전체 이미지 유지 + 위로 올라간 느낌

      // ✅ 예전처럼: 캔버스를 원본 픽셀 해상도로 유지
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight + PAD_BOTTOM;

      // 흰 배경
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // ✅ 이미지는 위쪽에 붙여 그리고(잘림 없음), 아래쪽에 여백이 남아서 위로 올라가 보임
      ctx.drawImage(img, 0, 0);

      // Reset 기준 저장
      originalRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      workingRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoRef.current = [];

      // 배경 추정(예전 방식과 동일한 픽셀 기반)
      const est = estimateBackground(ctx, canvas.width, canvas.height);
      setBg(est.bg);
      setBgTol(est.tol);
      console.log("estimated bg", est);

      // ✅ 이 줄이 없어서 hasMask=false 였음
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      bgMaskRef.current = buildBackgroundMask(
        imgData,
        est.bg,   // ⚠️ 반드시 est.bg 사용 (state 아님)
        est.tol
      );

      console.log("mask created", !!bgMaskRef.current);
    };

    img.src = imgUrl;
  }, [imgUrl]);

  // redraw on resize/orientation
  useEffect(() => {
    const onR = () => {
      if (imgRef.current) redrawFromImage();
    };
    window.addEventListener("resize", onR);
    window.addEventListener("orientationchange", () => setTimeout(onR, 150));
    return () => {
      window.removeEventListener("resize", onR);
      window.removeEventListener("orientationchange", onR as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getCanvasXY(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const pt = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    const cx = pt.clientX - rect.left;
    const cy = pt.clientY - rect.top;
    const x = Math.floor(cx * (canvas.width / rect.width));
    const y = Math.floor(cy * (canvas.height / rect.height));
    return { x, y };
  }

  // ===== Undo / Reset / Save (keep existing coloring logic) =====
  function pushUndo(ctx: CanvasRenderingContext2D) {
    const stack = undoRef.current;
    stack.push(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height));
    if (stack.length > 20) stack.shift();
  }

  function saveWorkingSnapshot(ctx: CanvasRenderingContext2D) {
    workingRef.current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  function undo() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const prev = undoRef.current.pop();
    if (prev) {
      ctx.putImageData(prev, 0, 0);
      saveWorkingSnapshot(ctx);
    }
  }

  function reset() {
    const canvas = canvasRef.current;
    const original = originalRef.current;
    if (!canvas || !original) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    undoRef.current = [];
    ctx.putImageData(original, 0, 0);
    saveWorkingSnapshot(ctx);
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = "colored.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  // ===== Paint helpers (existing algorithm) =====
  function getCanvasXYFromPointer(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const x = Math.floor(cx * (canvas.width / rect.width));
    const y = Math.floor(cy * (canvas.height / rect.height));
    return { x, y };
  }

  function paintAt(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    if (!originalRef.current) return;

    const mask = bgMaskRef.current;
    if (!mask) return;

    pushUndo(ctx);

    if (selected === "restore") {
      restoreAt(ctx, x, y, mask, 35);
    } else {
      floodFillWithBgMask(ctx, x, y, COLORS[selected], mask, 35);
    }

    saveWorkingSnapshot(ctx);
  }

  function restoreAt(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    bgMask: Uint8Array,
    tolerance = 35
  ) {
    const canvas = ctx.canvas;
    const w = canvas.width;
    const h = canvas.height;

    const current = ctx.getImageData(0, 0, w, h);
    const original = originalRef.current;
    if (!original) return;

    if (
      startX < 0 || startY < 0 ||
      startX >= w || startY >= h
    ) {
      return;
    }

    const startIdx = startY * w + startX;

    // 배경은 복원 대상으로 보지 않음
    if (bgMask[startIdx]) return;

    const data = current.data;
    const orig = original.data;

    const base = startIdx * 4;
    const targetR = data[base];
    const targetG = data[base + 1];
    const targetB = data[base + 2];
    const targetA = data[base + 3];

    const visited = new Uint8Array(w * h);
    const stack: number[] = [startIdx];

    function closeEnough(i: number) {
      const p = i * 4;
      return (
        Math.abs(data[p] - targetR) <= tolerance &&
        Math.abs(data[p + 1] - targetG) <= tolerance &&
        Math.abs(data[p + 2] - targetB) <= tolerance &&
        Math.abs(data[p + 3] - targetA) <= tolerance
      );
    }

    while (stack.length) {
      const idx = stack.pop()!;
      if (visited[idx]) continue;
      visited[idx] = 1;

      if (bgMask[idx]) continue;
      if (!closeEnough(idx)) continue;

      const p = idx * 4;

      // 현재 영역을 원본 픽셀로 복원
      data[p] = orig[p];
      data[p + 1] = orig[p + 1];
      data[p + 2] = orig[p + 2];
      data[p + 3] = orig[p + 3];

      const x = idx % w;
      const y = Math.floor(idx / w);

      if (x > 0) stack.push(idx - 1);
      if (x < w - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - w);
      if (y < h - 1) stack.push(idx + w);
    }

    ctx.putImageData(current, 0, 0);
  }

  console.log("APP.TSX LOADED ✅", new Date().toISOString());

  if (!adminAuthed) {
    return (
      <AdminLogin
        onSuccess={() => {
          setAdminAuthed(true);
          setPage("color");  // 로그인 성공 후 이동
        }}
      />
    );
  }

  return (
    <AppShell
      page={page}
      setPage={setPage}
      // keep existing top buttons (red/blue/undo/reset/save)
      colorToolbar={
        <>
          <label className="btn btnUpload">
            📷 Upload
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
          </label>

          <button className="btn" aria-pressed={selected === "red"} onClick={() => setSelected("red")}>
            <span className="sw" style={{ background: "#e53935" }} /> Red
          </button>
          <button className="btn" aria-pressed={selected === "blue"} onClick={() => setSelected("blue")}>
            <span className="sw" style={{ background: "#1e88e5" }} /> Blue
          </button>
          <button className="btn" aria-pressed={selected === "restore"} onClick={() => setSelected("restore")}>
            <span className="sw" style={{ background: "#ffffff", border: "1px solid #ccc" }} /> Restore
          </button>

          <button className="btn" onClick={undo} disabled={!hasImage}>
            ↩️ Undo
          </button>
          <button className="btn" onClick={reset} disabled={!hasImage}>
            🧼 Reset
          </button>
          {/* <button className="btn" onClick={savePng} disabled={!hasImage}>
            💾 Save
          </button> */}
          <button className="btn" onClick={saveColoredToDB}>
            {editingResultId !== null ? "💾 Update Colored Result" : "💾 Save Colored Result"}
          </button>
        </>
      }
    >
      {page === "member" ? (
        <MyMember onEditResult={startEditResult} />
      ) : page === "schedule" ? (
        <SchedulePage />
      ) : (
        <>
          <div className="colorLayout3">
            {/* Left panel: member input/load/save */}
            <section className="panelCard memberPanel">
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>Member</h3>

                {editingResultId !== null && (
                  <div style={{ marginBottom: 10, fontSize: 12, color: "#6b5cff", fontWeight: 700 }}>
                    Editing Result #{editingResultId}
                  </div>
                )}

              <div className="memberRow">
                <label style={{ flex: 1, marginBottom: 0, marginBottom: 0 }}>
                  Name
                  <input
                    value={member.name}
                    onChange={(e) => setMember({ ...member, name: e.target.value })}
                    placeholder="e.g. 김종학"
                  />
                </label>
                <button className="btn" onClick={loadMemberByName} disabled={loadingMember}>
                  {loadingMember ? "Loading..." : "Load"}
                </button>
              </div>

              <label>
                Number
                <input
                  value={member.number}
                  onChange={(e) => setMember({ ...member, number: e.target.value })}
                  placeholder="e.g. 100023"
                />
              </label>

              <label>
                Birth Date
                <input
                  type="date"
                  value={member.birth_date ?? ""}
                  onChange={(e) => setMember({ ...member, birth_date: e.target.value || ""})}
                />
              </label>

              <label>
                Height (cm)
                <input
                  type="number"
                  step="0.1"
                  value={member.height_cm ?? ""}
                  onChange={(e) =>
                    setMember({ ...member, height_cm: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                />
              </label>

              <label>
                Weight (kg)
                <input
                  type="number"
                  step="0.1"
                  value={member.weight_kg ?? ""}
                  onChange={(e) =>
                    setMember({ ...member, weight_kg: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                />
              </label>

              <label>
                Date
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </label>

              <label>
                Memo
                <textarea
                  rows={4}
                  value={member.memo ?? ""}
                  onChange={(e) => setMember({ ...member, memo: e.target.value })}
                  placeholder="optional"
                />
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={saveMemberToDB} disabled={savingMember}>
                  {savingMember ? "Saving..." : "Save Member"}
                </button>

                {editingResultId !== null && (
                  <button className="btn" onClick={cancelEditMode} type="button">
                    Cancel Edit
                  </button>
                )}
              </div>

              {memberMsg && <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>{memberMsg}</div>}
            </section>

            {/* Right: canvas */}
            <section className="panelCard canvasWrap">
              <canvas
                ref={canvasRef}
                className="canvasFullHeight"
                onClick={(e) => {
                  if (!hasImage) return;
                  const { x, y } = getCanvasXY(e);
                  paintAt(x, y);
                }}
                onTouchStart={(e) => {
                  if (!hasImage) return;
                  e.preventDefault(); // 스크롤 방지 (캔버스에서만)
                  const { x, y } = getCanvasXY(e);
                  paintAt(x, y);
                }}
              />
            </section>

            <section className="panelCard notePanel">
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>Note</h3>
              <textarea
                value={resultNote}
                onChange={(e) => setResultNote(e.target.value)}
                placeholder="Write any note about this coloring..."
                className="noteTextarea"
              />
            </section>
          </div>
        </>
      )}
      {page === "admin" && <AdminLogin />}
    </AppShell>
  );
}
