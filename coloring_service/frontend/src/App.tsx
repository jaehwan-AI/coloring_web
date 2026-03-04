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


type Color = "red" | "blue";

type MemberInfo = {
  number: string;
  name: string;
  memo?: string;
  height_cm?: number | null;
  weight_kg?: number | null;
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

    const res = await fetch("/api/results/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member: {
          number,
          name,
          memo: member.memo ?? "",
          height_cm: member.height_cm ?? null,
          weight_kg: member.weight_kg ?? null,
        },
        image_data_url,
        selected_date: selectedDate, // ✅ 함께 저장
        original_id: null,
        note: resultNote,
        original_upload_url: imgUrl,
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      alert(t || "Failed to save colored result.");
      return;
    }
    
    setResultNote("");  // 메모 초기화
    alert("Saved colored result!");
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
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    sizeCanvasToCssBox();

    const dpr = window.devicePixelRatio || 1;
    // ✅ Keep whole image + shift up slightly (about 10px)
    drawImageContainShiftUp(ctx, img, 10 * dpr);

    // baseline for Reset and for background estimation
    originalRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoRef.current = [];

    const est = estimateBackground(ctx, canvas.width, canvas.height);
    setBg(est.bg);
    setBgTol(est.tol);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bgMaskRef.current = buildBackgroundMask(
      imgData,
      est.bg,
      est.tol
    );
  }

  // ===== Load & draw image =====
  useEffect(() => {
    if (!imgUrl) return;

    const img = new Image();
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
      undoRef.current = [];

      // 배경 추정(예전 방식과 동일한 픽셀 기반)
      const est = estimateBackground(ctx, canvas.width, canvas.height);
      setBg(est.bg);
      setBgTol(est.tol);

      // ✅ 이 줄이 없어서 hasMask=false 였음
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      bgMaskRef.current = buildBackgroundMask(
        imgData,
        est.bg,   // ⚠️ 반드시 est.bg 사용 (state 아님)
        est.tol
      );
    };

    img.src = imgUrl + `?v=${Date.now()}`;
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

  function undo() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const prev = undoRef.current.pop();
    if (prev) ctx.putImageData(prev, 0, 0);
  }

  function reset() {
    const canvas = canvasRef.current;
    const original = originalRef.current;
    if (!canvas || !original) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    undoRef.current = [];
    ctx.putImageData(original, 0, 0);
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
    floodFillWithBgMask(ctx, x, y, COLORS[selected], mask, 35);
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
            💾 Save Colored Result
          </button>
        </>
      }
    >
      {page === "member" ? (
        <MyMember />
      ) : page === "schedule" ? (
        <SchedulePage />
      ) : (
        <>
          <div className="colorLayout3">
            {/* Left panel: member input/load/save */}
            <section className="panelCard memberPanel">
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>Member</h3>

              <div className="memberRow">
                <label style={{ flex: 1, marginBottom: 0 }}>
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
