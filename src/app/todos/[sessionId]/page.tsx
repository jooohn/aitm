"use client";

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import SessionDetail from "@/app/sessions/[id]/SessionDetail";
import { fetchSession, type Session } from "@/lib/utils/api";

export default function TodoSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const id = sessionId.replace(/^session-/, "");
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    fetchSession(id)
      .then(setSession)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return null;
  if (notFoundError || !session) return notFound();

  return <SessionDetail key={session.id} session={session} />;
}
