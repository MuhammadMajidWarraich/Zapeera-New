import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, ImagePlus, Loader2, Upload, X } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Reservation guest documents: the CNIC scan (image or PDF) and up to
// 5 photos of the persons staying. Files are uploaded the moment they
// are picked (the reservation create/update then just attaches the
// returned refs), and they come back ONLY through the authenticated,
// business-scoped document route — rendered here as blob URLs, the
// same treatment payment-proof screenshots get in the backoffice.

export const MAX_GUEST_PHOTOS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // mirrors the server cap
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const isPdfRef = (ref: string) => ref.toLowerCase().endsWith(".pdf");

function guardFile(file: File, kind: "cnic" | "photo"): string | null {
  if (file.size > MAX_FILE_SIZE) return "Each file can be at most 5 MB";
  if (kind === "photo" && !IMAGE_TYPES.includes(file.type)) {
    return "Guest photos must be JPEG, PNG or WEBP images";
  }
  if (kind === "cnic" && ![...IMAGE_TYPES, "application/pdf"].includes(file.type)) {
    return "The CNIC document must be a JPEG, PNG, WEBP or PDF file";
  }
  return null;
}

// ─── Editor (New Reservation dialog) ─────────────────────────────────

interface ReservationDocumentsEditorProps {
  cnicRef: string | null;
  photos: string[];
  onChange: (next: { cnicRef: string | null; photos: string[] }) => void;
  disabled?: boolean;
}

export const ReservationDocumentsEditor: React.FC<ReservationDocumentsEditorProps> = ({
  cnicRef,
  photos,
  onChange,
  disabled,
}) => {
  const cnicInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<"cnic" | "photo" | null>(null);
  // Instant local previews for files uploaded in this session, keyed by
  // the stored ref (existing refs arrive only in the viewer, not here).
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadOne = async (file: File, kind: "cnic" | "photo"): Promise<string | null> => {
    const problem = guardFile(file, kind);
    if (problem) {
      toast({ title: problem, variant: "destructive" });
      return null;
    }
    setUploading(kind);
    try {
      const response = await apiService.uploadReservationDocument(file, kind);
      if (response.success && response.data?.ref) {
        const ref = response.data.ref;
        if (!isPdfRef(ref)) {
          const url = URL.createObjectURL(file);
          setPreviews((prev) => ({ ...prev, [ref]: url }));
        }
        return ref;
      }
      toast({
        title: (response as any)?.message || "Upload failed",
        variant: "destructive",
      });
      return null;
    } catch (err: any) {
      toast({ title: err?.message || "Upload failed", variant: "destructive" });
      return null;
    } finally {
      setUploading(null);
    }
  };

  const pickCnic = async (file: File | null) => {
    if (!file) return;
    const ref = await uploadOne(file, "cnic");
    if (ref) onChange({ cnicRef: ref, photos });
  };

  const pickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_GUEST_PHOTOS - photos.length;
    if (room <= 0) {
      toast({
        title: `At most ${MAX_GUEST_PHOTOS} guest photos`,
        variant: "destructive",
      });
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) {
      toast({ title: `Only ${room} more photo${room === 1 ? "" : "s"} fit — extra files were skipped` });
    }
    const added: string[] = [];
    for (const file of picked) {
      const ref = await uploadOne(file, "photo");
      if (ref) added.push(ref);
    }
    if (added.length) onChange({ cnicRef, photos: [...photos, ...added] });
  };

  const removePhoto = (ref: string) => {
    if (previews[ref]) URL.revokeObjectURL(previews[ref]);
    onChange({ cnicRef, photos: photos.filter((p) => p !== ref) });
  };

  return (
    <div className="space-y-4">
      {/* CNIC document */}
      <div>
        <div className="text-sm font-medium mb-1">CNIC document</div>
        {cnicRef ? (
          <div className="flex items-center gap-3 rounded-lg border p-2">
            {isPdfRef(cnicRef) || !previews[cnicRef] ? (
              <div className="flex h-14 w-14 items-center justify-center rounded bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
            ) : (
              <img
                src={previews[cnicRef]}
                alt="CNIC document"
                className="h-14 w-14 rounded object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {isPdfRef(cnicRef) ? "CNIC document (PDF)" : "CNIC document"}
              </div>
              <div className="text-xs text-muted-foreground">Uploaded — it attaches to this reservation when you save.</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || uploading !== null}
              onClick={() => cnicInputRef.current?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || uploading !== null}
              onClick={() => onChange({ cnicRef: null, photos })}
              aria-label="Remove CNIC document"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={disabled || uploading !== null}
            onClick={() => cnicInputRef.current?.click()}
          >
            {uploading === "cnic" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            Upload CNIC (image or PDF, max 5 MB)
          </Button>
        )}
        <input
          ref={cnicInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            void pickCnic(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />
      </div>

      {/* Guest photos */}
      <div>
        <div className="text-sm font-medium mb-1">
          Photos of the persons{" "}
          <span className="font-normal text-muted-foreground">
            ({photos.length}/{MAX_GUEST_PHOTOS})
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {photos.map((ref) => (
            <div key={ref} className="relative h-20 w-20 overflow-hidden rounded-lg border">
              {previews[ref] ? (
                <img src={previews[ref]} alt="Guest" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <button
                type="button"
                disabled={disabled || uploading !== null}
                onClick={() => removePhoto(ref)}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                aria-label="Remove photo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {photos.length < MAX_GUEST_PHOTOS && (
            <button
              type="button"
              disabled={disabled || uploading !== null}
              onClick={() => photoInputRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground"
            >
              {uploading === "photo" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
              <span className="text-[11px]">Add photo</span>
            </button>
          )}
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            void pickPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
};

// ─── Viewer (reservation detail / folio) ──────────────────────────────

const DocumentImage: React.FC<{ reservationId: string; docRef: string; alt: string; className?: string }> = ({
  reservationId,
  docRef,
  alt,
  className,
}) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    apiService
      .fetchReservationDocumentBlob(reservationId, docRef)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reservationId, docRef]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center rounded-lg border bg-muted/40 text-xs text-muted-foreground ${className || "h-24 w-24"}`}>
        Could not load
      </div>
    );
  }
  if (!src) {
    return (
      <div className={`flex items-center justify-center rounded-lg border ${className || "h-24 w-24"}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Open full size">
      <img src={src} alt={alt} className={`rounded-lg border object-cover ${className || "h-24 w-24"}`} />
    </a>
  );
};

const PdfDocumentChip: React.FC<{ reservationId: string; docRef: string; label: string }> = ({
  reservationId,
  docRef,
  label,
}) => {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const blob = await apiService.fetchReservationDocumentBlob(reservationId, docRef);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      toast({ title: err?.message || "Could not open the document", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={open} disabled={busy}>
      {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
      {label}
    </Button>
  );
};

interface ReservationDocumentsViewerProps {
  reservationId: string;
  cnicRef?: string | null;
  photos?: string[] | null;
}

export const ReservationDocumentsViewer: React.FC<ReservationDocumentsViewerProps> = ({
  reservationId,
  cnicRef,
  photos,
}) => {
  const photoList = Array.isArray(photos) ? photos : [];
  if (!cnicRef && photoList.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Guest documents</div>
      {cnicRef &&
        (isPdfRef(cnicRef) ? (
          <PdfDocumentChip reservationId={reservationId} docRef={cnicRef} label="CNIC document (PDF) — open" />
        ) : (
          <div>
            <div className="mb-1 text-xs text-muted-foreground">CNIC document</div>
            <DocumentImage
              reservationId={reservationId}
              docRef={cnicRef}
              alt="CNIC document"
              className="h-28 w-44"
            />
          </div>
        ))}
      {photoList.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Photos of the persons ({photoList.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {photoList.map((ref) => (
              <DocumentImage
                key={ref}
                reservationId={reservationId}
                docRef={ref}
                alt="Guest"
                className="h-24 w-24"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReservationDocumentsEditor;
