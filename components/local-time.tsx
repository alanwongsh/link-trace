"use client";

import { useEffect, useState } from "react";

// A date, or date and time with its UTC offset ("Oct 19, 14:05 GMT+8"), so readers in other
// zones know which clock it is. timeZone: show it in that zone (such as the workspace's reporting
// zone, to match its daily counts); otherwise in the viewer's own.
export function LocalTime({
  iso,
  withTime = true,
  timeZone,
}: {
  iso: string;
  withTime?: boolean;
  timeZone?: string;
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
        timeZone,
        month: "short",
        day: "numeric",
        year: withTime ? undefined : "numeric",
        hour: withTime ? "2-digit" : undefined,
        minute: withTime ? "2-digit" : undefined,
        hourCycle: "h23",
        timeZoneName: withTime ? "shortOffset" : undefined,
      }).format(date),
    );
  }, [iso, withTime, timeZone]);

  return <time dateTime={iso}>{text}</time>;
}
