"use client";

import { Fragment } from "react";

export default function WorktreeLayout({
  children,
  drawer,
}: {
  children: React.ReactNode;
  drawer: React.ReactNode;
}) {
  return [
    <Fragment key="content">{children}</Fragment>,
    <Fragment key="drawer">{drawer}</Fragment>,
  ];
}
