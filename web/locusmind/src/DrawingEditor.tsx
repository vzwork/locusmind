import { useEffect, useRef, useState } from "react";
import { Excalidraw, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

type Scene = Awaited<ReturnType<typeof loadFromBlob>>;

export default function DrawingEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (content: string) => void;
}) {
  const [initialContent] = useState(content);
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");
  const lastSaved = useRef("");

  useEffect(() => {
    let active = true;
    loadFromBlob(
      new Blob([initialContent], { type: "application/json" }),
      null,
      null,
    ).then(
      (loaded) => {
        if (!active) return;
        lastSaved.current = serializeAsJSON(
          loaded.elements,
          loaded.appState,
          loaded.files,
          "local",
        );
        setScene(loaded);
      },
      (reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error ? reason.message : "Invalid Excalidraw file.",
        );
      },
    );
    return () => {
      active = false;
    };
  }, [initialContent]);

  if (error) {
    return (
      <div className="drawing-error" role="alert">
        Could not open this drawing: {error} Download the file to recover its
        contents.
      </div>
    );
  }

  if (!scene) return <div className="drawing-editor-wrap">Loading drawing…</div>;

  return (
    <div className="drawing-editor-wrap">
      <Excalidraw
        initialData={scene}
        onChange={(elements, appState, files) => {
          const next = serializeAsJSON(elements, appState, files, "local");
          if (next !== lastSaved.current) {
            lastSaved.current = next;
            onChange(next);
          }
        }}
      />
    </div>
  );
}
