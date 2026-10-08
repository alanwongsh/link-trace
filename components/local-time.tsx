"use client";

import { useEffect, useState } from "react";

export function LocalTime({
  iso,
  withTime = true,
}: {
  iso: string;
  withTime?: boolean;
}) {
  const [text, setText] = useState("…");

  useEffect(() => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      setText(iso);
      return;
    }
    setText(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: withTime ? undefined : "numeric",
        hour: withTime ? "2-digit" : undefined,
        minute: withTime ? "2-digit" : undefined,
        hourCycle: "h23",
      }).format(date),
    );
  }, [iso, withTime]);

  return <time dateTime={iso}>{text}</time>;
}
