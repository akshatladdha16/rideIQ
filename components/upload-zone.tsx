"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Loader2, UploadCloud } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import type { InvoiceRecord } from "@/lib/types";

interface UploadZoneProps {
  onUploadSuccess?: (invoice: InvoiceRecord) => void;
}

export function UploadZone({ onUploadSuccess }: UploadZoneProps): JSX.Element {
  const [isUploading, setIsUploading] = useState(false);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [activeFileSize, setActiveFileSize] = useState<number | null>(null);
  const [preview, setPreview] = useState<InvoiceRecord | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) {
        return;
      }

      setIsUploading(true);
      setActiveFileName(file.name);
      setActiveFileSize(file.size);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const payload = (await res.json()) as {
          error?: string;
          invoice?: InvoiceRecord;
        };

        if (!res.ok) {
          if (res.status === 409) {
            toast.warning("Already uploaded", {
              description: "This invoice has already been uploaded.",
            });
            return;
          }

          throw new Error(payload.error ?? "Upload failed");
        }

        if (payload.invoice) {
          setPreview(payload.invoice);
          onUploadSuccess?.(payload.invoice);
          toast.success("Invoice processed", {
            description: "OCR and ingestion completed successfully.",
          });
        }
      } catch (error: unknown) {
        toast.error("Upload failed", {
          description: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadSuccess]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
    multiple: false,
  });

  return (
    <div className="space-y-4">
      <Card
        {...getRootProps()}
        className={`cursor-pointer border-dashed transition-all ${
          isDragActive ? "border-primary bg-primary/5" : "hover:border-primary/60"
        }`}
      >
        <CardContent className="flex min-h-44 flex-col items-center justify-center gap-3 p-8 text-center">
          <input {...getInputProps()} />
          {isUploading ? (
            <Loader2 className="size-8 animate-spin text-primary" />
          ) : (
            <UploadCloud className="size-8 text-primary" />
          )}
          <div>
            <p className="text-lg font-semibold">
              {isDragActive
                ? "Drop your Rapido invoice here"
                : "Drag and drop Rapido invoice PDF"}
            </p>
            <p className="text-sm text-muted-foreground">
              {isUploading
                ? "Processing OCR, generating embeddings, and saving to Supabase..."
                : "or click to upload"}
            </p>
          </div>
          {activeFileName && (
            <p className="text-xs text-muted-foreground">
              {activeFileName}
              {activeFileSize ? ` (${(activeFileSize / 1024).toFixed(1)} KB)` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest Extraction Preview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Date:</span> {formatDate(preview.ride_date)}
            </p>
            <p>
              <span className="text-muted-foreground">Route:</span> {preview.pickup_area ?? "--"} to{" "}
              {preview.dropoff_area ?? "--"}
            </p>
            <p>
              <span className="text-muted-foreground">Fare:</span> {formatCurrency(preview.total_fare)}
            </p>
            <p>
              <span className="text-muted-foreground">Captain:</span> {preview.captain_name ?? "--"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
