"use client";

import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "i18n-iso-countries";
import world from "world-atlas/countries-110m.json";

type CountryRow = { country: string; clicks: number };

const WIDTH = 800;
const HEIGHT = 420;

export function VisitorMap({ countries: rows }: { countries: CountryRow[] }) {
  const located = useMemo(
    () => rows.filter((row) => row.country && row.country !== "Unknown"),
    [rows],
  );
  const unlocated = rows.find((row) => row.country === "Unknown")?.clicks ?? 0;
  const max = Math.max(...located.map((row) => row.clicks), 0);

  const byId = useMemo(() => {
    const map = new Map<string, { name: string; clicks: number }>();
    for (const row of located) {
      const numeric = countries.alpha2ToNumeric(row.country);
      if (!numeric) continue;
      map.set(String(Number(numeric)), {
        name: countryName(row.country),
        clicks: row.clicks,
      });
    }
    return map;
  }, [located]);

  const shapes = useMemo(() => {
    const topology = world as unknown as Topology<{ countries: GeometryCollection }>;
    const collection = feature(
      topology,
      topology.objects.countries,
    ) as FeatureCollection<Geometry>;
    const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], collection);
    const draw = geoPath(projection);
    return collection.features.map((shape) => ({
      id: shape.id == null ? "" : String(Number(shape.id)),
      d: draw(shape as Feature) ?? "",
    }));
  }, []);

  const [active, setActive] = useState<{ name: string; clicks: number } | null>(null);

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="sub-title">Visitor map</h2>
          <p className="mt-1 text-sm text-muted">
            Darker countries had more clicks. Visits from this computer are not on the map.
          </p>
        </div>
        <p className="text-sm text-muted">
          {active
            ? `${active.name} · ${active.clicks} ${active.clicks === 1 ? "click" : "clicks"}`
            : unlocated > 0
              ? `${unlocated} with no location`
              : "Hover a country"}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-4 h-auto w-full"
        role="img"
        aria-label="World map of visitor countries"
      >
        <rect width={WIDTH} height={HEIGHT} fill="#f7f3eb" rx={12} />
        {shapes.map((shape) => {
          const hit = byId.get(shape.id);
          return (
            <path
              key={shape.id || shape.d.slice(0, 24)}
              d={shape.d}
              fill={hit ? shade(hit.clicks / max) : "#e4ddd0"}
              stroke="#f7f3eb"
              strokeWidth={0.6}
              className={hit ? "cursor-pointer" : undefined}
              onMouseEnter={() => hit && setActive(hit)}
              onMouseLeave={() => setActive(null)}
            >
              {hit ? <title>{`${hit.name}: ${hit.clicks}`}</title> : null}
            </path>
          );
        })}
      </svg>
    </section>
  );
}

function shade(amount: number): string {
  const from = [176, 214, 208];
  const to = [15, 95, 90];
  const mix = from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  );
  return `rgb(${mix.join(",")})`;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
