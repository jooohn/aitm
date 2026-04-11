"use client";

import { useParams } from "next/navigation";
import NewChatDetail from "./NewChatDetail";

export default function NewChatPage() {
  const { organization, name } = useParams<{
    organization: string;
    name: string;
  }>();

  return <NewChatDetail organization={organization} name={name} />;
}
