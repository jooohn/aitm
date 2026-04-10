import { access, readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { chatService } from "@/backend/container";

type Params = Promise<{ id: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { id } = await params;
  const chat = chatService.getChat(id);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const entries: unknown[] = [];
  try {
    await access(chat.log_file_path);
    const content = await readFile(chat.log_file_path, "utf8");
    for (const line of content.split("\n")) {
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch {
    // log file may not exist yet
  }

  return NextResponse.json(entries);
}
