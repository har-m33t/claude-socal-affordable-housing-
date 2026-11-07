import { Editor } from "@/components/editor/Editor";

export default function Home() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[640px] flex-col">
      <Editor />
    </div>
  );
}
