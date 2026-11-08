import { MemoryView } from "@/components/MemoryView";
import { PageHeader } from "@/components/shell/PageHeader";
import { mockBrief, mockCards, mockRules } from "@/lib/mock";

export default function MemoryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Memory"
        description="What Shiplog knows about this project and how you write. Everything here is editable."
      />
      <MemoryView brief={mockBrief} cards={mockCards} rules={mockRules} />
    </div>
  );
}
