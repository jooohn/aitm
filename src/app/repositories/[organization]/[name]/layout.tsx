"use client";

import { useParams } from "next/navigation";
import RepositoryShell from "@/app/components/RepositoryShell";

export default function RepositoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { organization, name } = useParams<{
    organization: string;
    name: string;
  }>();

  return (
    <RepositoryShell organization={organization} name={name}>
      {children}
    </RepositoryShell>
  );
}
