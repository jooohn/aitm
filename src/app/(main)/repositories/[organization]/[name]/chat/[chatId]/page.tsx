"use client";

import { useParams } from "next/navigation";
import ChatDetail from "./ChatDetail";

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();

  return <ChatDetail chatId={chatId} />;
}
