import React, { useEffect, useMemo, useState } from "react";

type GalleryItem = {
  id: string;
  createdAt: string;          // ISO string
  originalId?: string | null;
  thumbUrl: string;           // e.g. "/api/images/<thumbId>" or "/uploads/..."
  url?: string;               // optional full image view url
  downloadUrl?: string;       // optional explicit download url
  filename?: string;          // optional (for nicer download name)
};

type ResultsResponse = {
  items: GalleryItem[];
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

export default function MyGallery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(e?.message || "Failed to load gallery.");
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

  async function downloadItem(item: GalleryItem) {
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
    <div style={{ padding: 16 }}>
      <div style={styles.headerRow}>
        <h2 style={{ margin: 0 }}>My Gallery</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={styles.btn} onClick={loadFirstPage} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.errorBox}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16, color: "#666" }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16, color: "#666" }}>
          No results yet. Save a colored image to see it here.
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            {items.map((it) => (
              <div
                key={it.id}
                style={{
                  ...styles.card,
                  outline: selectedId === it.id ? "3px solid rgba(0,0,0,0.12)" : "none"
                }}
              >
                <button
                  style={styles.thumbBtn}
                  onClick={() => setSelectedId(it.id)}
                  title="Open"
                >
                  <img
                    src={it.thumbUrl}
                    alt={`thumb-${it.id}`}
                    style={styles.thumbImg}
                    loading="lazy"
                  />
                </button>

                <div style={styles.meta}>
                  <div style={styles.metaTop}>
                    <span style={styles.dateText}>{formatDate(it.createdAt)}</span>
                  </div>
                  <div style={styles.actions}>
                    <button style={styles.btnSmall} onClick={() => downloadItem(it)}>
                      Download
                    </button>
                    <button
                      style={{ ...styles.btnSmall, ...styles.btnDanger }}
                      onClick={() => {
                        if (confirm("Delete this image?")) deleteItem(it.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
            {nextCursor ? (
              <button style={styles.btn} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            ) : (
              <span style={{ color: "#777" }}>No more results</span>
            )}
          </div>
        </>
      )}

      {/* Simple modal preview */}
      {selected && (
        <div style={styles.modalOverlay} onClick={() => setSelectedId(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <strong>Preview</strong>
                <span style={{ fontSize: 12, color: "#666" }}>{formatDate(selected.createdAt)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={styles.btnSmall} onClick={() => downloadItem(selected)}>
                  Download
                </button>
                <button
                  style={{ ...styles.btnSmall, ...styles.btnDanger }}
                  onClick={() => {
                    if (confirm("Delete this image?")) deleteItem(selected.id);
                  }}
                >
                  Delete
                </button>
                <button style={styles.btnSmall} onClick={() => setSelectedId(null)}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 12 }}>
              <img
                src={selected.url || selected.thumbUrl || `/api/images/${encodeURIComponent(selected.id)}`}
                alt={`full-${selected.id}`}
                style={styles.previewImg}
              />
            </div>
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
