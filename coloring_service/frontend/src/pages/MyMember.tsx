import React, { useEffect, useMemo, useState } from "react";


type Member = {
  id: number;
  number: string;
  name: string;
  height_cm?: number | null;
  weight_kg?: number | null;
  memo?: string | null;
}

type ResultItem = {
  id: number;
  selected_date?: string | null; // "YYYY-MM-DD"
  created_at: string;
  url: string; // "/uploads/...png"
  note?: string | null;
};

type ApiResponse = {
  member: Member;
  items: ResultItem[];
}

type MemberItem = {
  id: string;
  createdAt: string;          // ISO string
  originalId?: string | null;
  thumbUrl: string;           // e.g. "/api/images/<thumbId>" or "/uploads/..."
  url?: string;               // optional full image view url
  downloadUrl?: string;       // optional explicit download url
  filename?: string;          // optional (for nicer download name)
};

type ResultsResponse = {
  items: MemberItem[];
  nextCursor: string | null;
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Download helper:
 * - fetches the image as blob (so cookies/auth are included)
 * - triggers browser download
 */
async function downloadByFetch(url: string, filename: string) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(blobUrl);
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function groupByDate(items: ResultItem[]) {
  const map = new Map<string, ResultItem[]>();
  for (const it of items) {
    const key = it.selected_date ?? "No Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  // 날짜 내림차순 정렬 ("No Date"는 마지막)
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === "No Date") return 1;
    if (b === "No Date") return -1;
    return b.localeCompare(a);
  });
  return keys.map((k) => ({ date: k, items: map.get(k)! }));
}

export default function MyMember() {
  const [number, setNumber] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<MemberItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const n = number.trim();
    if (!n) {
      setMsg("Member number를 입력하세요.");
      return;
    }
    setLoading(true);
    setMsg("");

    try {
      const res = await fetch(`/api/members/${encodeURIComponent(n)}/results`);

      if (!res.ok) {
        setMsg(res.status === 404 ? "Member not found" : "불러오기 실패");
        setData(null);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch {
      setMsg("네트워크 오류");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => (data ? groupByDate(data.items) : []), [data]);

  // Modal (member results)
  const [selectedResult, setSelectedResult] = useState<ResultItem | null>(null);


  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) || null,
    [items, selectedId]
  );

  const PAGE_LIMIT = 24;

  async function loadFirstPage() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ResultsResponse>(`/api/results?limit=${PAGE_LIMIT}`);
      setItems(data.items || []);
      setNextCursor(data.nextCursor ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load member.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchJson<ResultsResponse>(
        `/api/results?limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(nextCursor)}`
      );
      setItems((prev) => [...prev, ...(data.items || [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function deleteItem(id: string) {
    // Optimistic UI
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);

    try {
      const res = await fetch(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed: ${res.status}`);
      }
    } catch (e: any) {
      // rollback
      setItems(prev);
      setError(e?.message || "Delete failed.");
    }
  }

  async function downloadItem(item: MemberItem) {
    const url = item.downloadUrl || (item.url ?? `/api/images/${encodeURIComponent(item.id)}`);
    const safeName =
      item.filename ||
      `colored_${item.id.slice(0, 8)}.png`;

    try {
      await downloadByFetch(url, safeName);
    } catch (e: any) {
      setError(e?.message || "Download failed.");
    }
  }

  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 12 }}>
      <h2 style={{ marginTop: 0 }}>My Member</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Number
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="예: 100023" />
        </label>

        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Load"}
        </button>
      </div>

      {msg && <div style={{ marginTop: 10, color: "#666" }}>{msg}</div>}

      {data && (
        <div style={{ marginTop: 14 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 12, boxShadow: "0 8px 20px rgba(0,0,0,0.06)" }}>
            <div><b>{data.member.name}</b> (#{data.member.number})</div>
            <div style={{ color: "#666", marginTop: 6 }}>
              Height: {data.member.height_cm ?? "-"} cm / Weight: {data.member.weight_kg ?? "-"} kg
            </div>
            {data.member.memo ? <div style={{ marginTop: 6 }}>{data.member.memo}</div> : null}
          </div>

          <div style={{ marginTop: 14 }}>
            {grouped.length === 0 ? (
              <div style={{ color: "#666" }}>저장된 색칠 결과가 없습니다.</div>
            ) : (
              grouped.map((g) => (
                <div key={g.date} style={{ marginBottom: 18 }}>
                  <h3 style={{ margin: "10px 0" }}>{g.date}</h3>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 10,
                    }}
                  >
                    {g.items.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => setSelectedResult(it)}
                        style={{
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          background: "#fff",
                          borderRadius: 12,
                          overflow: "hidden",
                          boxShadow: "0 6px 14px rgba(0,0,0,0.08)",
                        }}
                        title={`Result #${it.id}`}
                      >
                        <img
                          src={it.url}
                          alt={`result-${it.id}`}
                          style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }}
                          loading="lazy"
                        />
                        <div style={{ padding: 8, fontSize: 12, color: "#666" }}>
                          #{it.id}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Result detail modal (image + note) */}
      {selectedResult && (
        <div style={styles.modalOverlay} onClick={() => setSelectedResult(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ fontWeight: 800 }}>
                {selectedResult.selected_date ?? "No Date"} · Result #{selectedResult.id}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  className="btn"
                  href={selectedResult.url}
                  download
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </a>
                <button className="btn" type="button" onClick={() => setSelectedResult(null)}>
                  Close
                </button>
              </div>
            </div>

            <div
              className="member-result-modal-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 360px",
                gap: 0,
              }}
            >
              <div style={{ padding: 12, background: "#fafafa" }}>
                <img src={selectedResult.url} alt="selected" style={styles.previewImg} />
              </div>

              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Note</div>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    border: "1px solid rgba(0,0,0,0.12)",
                    borderRadius: 12,
                    padding: 12,
                    minHeight: 140,
                    background: "#fff",
                  }}
                >
                  {selectedResult.note?.trim() ? selectedResult.note : "No note saved."}
                </div>
              </div>
            </div>

            {/* Mobile/iPad: stack columns */}
            <style>{`
              @media (max-width: 900px) {
                .member-result-modal-grid {
                  grid-template-columns: 1fr !important;
                }
              }
            `}</style>
          </div>
        </div>
      )}

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12
  },
  btn: {
    border: "1px solid rgba(0,0,0,0.14)",
    background: "#fff",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 700,
    cursor: "pointer"
  },
  btnSmall: {
    border: "1px solid rgba(0,0,0,0.14)",
    background: "#fff",
    borderRadius: 10,
    padding: "8px 10px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12
  },
  btnDanger: {
    borderColor: "rgba(220,0,0,0.25)",
  },
  errorBox: {
    background: "rgba(220,0,0,0.08)",
    border: "1px solid rgba(220,0,0,0.18)",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    color: "#7a0000",
    fontWeight: 600
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
    overflow: "hidden"
  },
  thumbBtn: {
    border: "none",
    background: "transparent",
    padding: 0,
    width: "100%",
    cursor: "pointer"
  },
  thumbImg: {
    width: "100%",
    height: 160,
    objectFit: "cover",
    display: "block",
    background: "#f3f3f3"
  },
  meta: {
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 10
  },
  metaTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  dateText: {
    fontSize: 12,
    color: "#666"
  },
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "space-between"
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    zIndex: 50
  },
  modal: {
    width: "min(980px, 96vw)",
    maxHeight: "90vh",
    background: "#fff",
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)"
  },
  modalHeader: {
    padding: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    borderBottom: "1px solid rgba(0,0,0,0.08)"
  },
  previewImg: {
    width: "100%",
    height: "auto",
    maxHeight: "75vh",
    objectFit: "contain",
    display: "block",
    background: "#fafafa",
    borderRadius: 12
  }
};
