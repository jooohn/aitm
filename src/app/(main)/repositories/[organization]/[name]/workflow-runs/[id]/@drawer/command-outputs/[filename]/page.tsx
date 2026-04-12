import { notFound } from "next/navigation";
import CommandOutputDrawer from "@/app/(main)/repositories/[organization]/[name]/workflow-runs/[id]/CommandOutputDrawer";
import { getWorkflowRunCommandOutput } from "@/backend/domain/workflow-runs/command-output";

type Params = Promise<{ id: string; filename: string }>;

export default async function CommandOutputDrawerPage({
  params,
}: {
  params: Params;
}) {
  const { id, filename } = await params;
  const output = await getWorkflowRunCommandOutput(id, filename);
  if (!output) {
    notFound();
  }

  return (
    <CommandOutputDrawer filename={output.filename} content={output.content} />
  );
}
